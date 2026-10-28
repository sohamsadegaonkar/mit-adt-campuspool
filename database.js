// =========================================================================
// MIT ADT CampusPool - Embedded SQLite Relational Database Engine
// Powered by better-sqlite3 with WAL mode, Foreign Keys & ACID Transactions
// =========================================================================

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_SQLITE_FILE = process.env.DATABASE_PATH || path.join(__dirname, 'campuspool.db');
const LEGACY_JSON_FILE = path.join(__dirname, 'campuspool_database.json');

class SQLiteCampusDatabase {
  constructor(dbPath = DB_SQLITE_FILE) {
    this.dbPath = dbPath;
    this.db = new Database(this.dbPath);

    // High performance write-ahead logging & strict relational integrity
    try {
      this.db.pragma('journal_mode = WAL');
    } catch (e) {
      console.warn('[SQLITE] WAL mode unavailable in this environment, using DELETE journal mode:', e.message);
      this.db.pragma('journal_mode = DELETE');
    }
    this.db.pragma('foreign_keys = ON');

    this.initTables();
    this.migrateOrSeed();
  }

  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL COLLATE NOCASE,
        phone TEXT UNIQUE NOT NULL,
        dept TEXT,
        is_verified INTEGER DEFAULT 1,
        verified_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rides (
        id TEXT PRIMARY KEY,
        driver_name TEXT NOT NULL,
        driver_email TEXT NOT NULL COLLATE NOCASE,
        driver_phone TEXT NOT NULL,
        dept TEXT,
        vehicle TEXT NOT NULL,
        vehicle_model TEXT NOT NULL,
        pickup TEXT NOT NULL,
        destination TEXT NOT NULL,
        departure_time TEXT NOT NULL,
        seats_total INTEGER NOT NULL,
        seats_left INTEGER NOT NULL,
        uber_benchmark REAL NOT NULL,
        student_fare REAL NOT NULL,
        driver_payout REAL NOT NULL,
        note TEXT,
        upi_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bookings (
        booking_id TEXT PRIMARY KEY,
        ride_id TEXT NOT NULL,
        passenger_email TEXT NOT NULL COLLATE NOCASE,
        passenger_name TEXT NOT NULL,
        driver_name TEXT NOT NULL,
        driver_email TEXT NOT NULL COLLATE NOCASE,
        driver_phone TEXT NOT NULL,
        dept TEXT,
        vehicle_model TEXT,
        pickup TEXT NOT NULL,
        destination TEXT NOT NULL,
        departure_time TEXT NOT NULL,
        student_fare REAL NOT NULL,
        payment_status TEXT DEFAULT 'Pending',
        upi_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (ride_id) REFERENCES rides (id)
      );

      CREATE TABLE IF NOT EXISTS otp_verifications (
        id TEXT PRIMARY KEY,
        identifier TEXT NOT NULL COLLATE NOCASE,
        type TEXT NOT NULL,
        hashed_otp TEXT NOT NULL,
        attempts_left INTEGER DEFAULT 5,
        expires_at INTEGER NOT NULL,
        resend_cooldown_until INTEGER NOT NULL,
        is_verified INTEGER DEFAULT 0,
        token TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS driver_settlements (
        id TEXT PRIMARY KEY,
        driver_email TEXT NOT NULL COLLATE NOCASE,
        amount REAL NOT NULL,
        settled_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
      CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles(phone);
      CREATE INDEX IF NOT EXISTS idx_rides_dest ON rides(destination);
      CREATE INDEX IF NOT EXISTS idx_rides_created ON rides(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_bookings_ride ON bookings(ride_id);
      CREATE INDEX IF NOT EXISTS idx_otp_lookup ON otp_verifications(identifier, type);
      CREATE INDEX IF NOT EXISTS idx_driver_settlements_email ON driver_settlements(driver_email);
    `);
  }

  migrateOrSeed() {
    const profileCount = this.db.prepare('SELECT COUNT(*) as count FROM profiles').get().count;
    if (profileCount > 0) {
      console.log(`[SQLITE] Connected to campuspool.db (${profileCount} verified profiles loaded)`);
      return;
    }

    console.log('[SQLITE] Database is empty. Checking for existing campuspool_database.json to migrate...');

    let migrated = false;
    if (fs.existsSync(LEGACY_JSON_FILE)) {
      try {
        const raw = fs.readFileSync(LEGACY_JSON_FILE, 'utf8');
        const legacy = JSON.parse(raw);

        const insertProfile = this.db.prepare(`
          INSERT OR IGNORE INTO profiles (id, name, email, phone, dept, is_verified, verified_at, created_at)
          VALUES (@id, @name, @email, @phone, @dept, @is_verified, @verified_at, @created_at)
        `);

        const insertRide = this.db.prepare(`
          INSERT OR IGNORE INTO rides (
            id, driver_name, driver_email, driver_phone, dept, vehicle, vehicle_model,
            pickup, destination, departure_time, seats_total, seats_left,
            uber_benchmark, student_fare, driver_payout, note, upi_id, created_at
          ) VALUES (
            @id, @driver_name, @driver_email, @driver_phone, @dept, @vehicle, @vehicle_model,
            @pickup, @destination, @departure_time, @seats_total, @seats_left,
            @uber_benchmark, @student_fare, @driver_payout, @note, @upi_id, @created_at
          )
        `);

        const migrateTx = this.db.transaction(() => {
          if (Array.isArray(legacy.profiles)) {
            for (const p of legacy.profiles) {
              insertProfile.run({
                id: p.id || crypto.randomUUID(),
                name: p.name,
                email: p.email.toLowerCase(),
                phone: p.phone,
                dept: p.dept || 'MIT School of Computing',
                is_verified: p.isVerified ? 1 : 0,
                verified_at: p.verifiedAt || p.createdAt || new Date().toISOString(),
                created_at: p.createdAt || new Date().toISOString()
              });
            }
          }

          if (Array.isArray(legacy.rides)) {
            for (const r of legacy.rides) {
              insertRide.run({
                id: r.id,
                driver_name: r.driverName,
                driver_email: r.driverEmail.toLowerCase(),
                driver_phone: r.driverPhone,
                dept: r.dept,
                vehicle: r.vehicle,
                vehicle_model: r.vehicleModel,
                pickup: r.pickup,
                destination: r.destination,
                departure_time: r.departureTime,
                seats_total: r.seatsTotal,
                seats_left: r.seatsLeft,
                uber_benchmark: r.uberBenchmark,
                student_fare: r.studentFare,
                driver_payout: r.driverPayout,
                note: r.note || '',
                upi_id: r.upiId || '',
                created_at: r.createdAt || new Date().toISOString()
              });
            }
          }
        });

        migrateTx();
        migrated = true;
        console.log('[SQLITE] Successfully migrated all existing users and rides from campuspool_database.json into SQLite campuspool.db!');
      } catch (err) {
        console.warn('[SQLITE] Legacy JSON migration error, seeding defaults:', err.message);
      }
    }

    if (!migrated) {
      this.seedDefaults();
    }
  }

  seedDefaults() {
    // Production ready: Clean empty database with zero demo profiles and zero seed rides.
    console.log('[SQLITE] Database initialized with clean schema (0 demo profiles, 0 demo rides)');
  }

  // -----------------------------------------------------------------------
  // Profiles / Users API
  // -----------------------------------------------------------------------
  getProfiles() {
    const rows = this.db.prepare('SELECT * FROM profiles ORDER BY created_at DESC').all();
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      dept: r.dept,
      isVerified: Boolean(r.is_verified),
      verifiedAt: r.verified_at,
      createdAt: r.created_at
    }));
  }

  getProfileByEmail(email) {
    if (!email) return null;
    const r = this.db.prepare('SELECT * FROM profiles WHERE email = ? COLLATE NOCASE').get(email.trim());
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      dept: r.dept,
      isVerified: Boolean(r.is_verified),
      verifiedAt: r.verified_at,
      createdAt: r.created_at
    };
  }

  getProfileByIdentifier(identifier) {
    if (!identifier) return null;
    const clean = identifier.trim().toLowerCase();
    const cleanDigits = clean.replace(/[^0-9]/g, '').slice(-10);

    // Try email first
    let r = this.db.prepare('SELECT * FROM profiles WHERE email = ? COLLATE NOCASE').get(clean);
    // If not found and identifier has 10 digits, search by phone
    if (!r && cleanDigits.length === 10) {
      const all = this.db.prepare('SELECT * FROM profiles').all();
      r = all.find(p => (p.phone || '').replace(/[^0-9]/g, '').slice(-10) === cleanDigits);
    }

    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      dept: r.dept,
      isVerified: Boolean(r.is_verified),
      verifiedAt: r.verified_at,
      createdAt: r.created_at
    };
  }

  checkUniqueness(name, email, phone) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '').slice(-10);

    const existingByEmail = this.db.prepare('SELECT * FROM profiles WHERE email = ? COLLATE NOCASE').get(cleanEmail);
    if (existingByEmail) {
      return {
        unique: true,
        isExistingUser: true,
        user: {
          id: existingByEmail.id,
          name: existingByEmail.name,
          email: existingByEmail.email,
          phone: existingByEmail.phone,
          dept: existingByEmail.dept,
          isVerified: Boolean(existingByEmail.is_verified),
          verifiedAt: existingByEmail.verified_at,
          createdAt: existingByEmail.created_at
        },
        message: `Welcome back, ${existingByEmail.name}! Ready to log in.`
      };
    }

    if (cleanPhone) {
      const allProfiles = this.db.prepare('SELECT phone FROM profiles').all();
      for (const p of allProfiles) {
        const digits = (p.phone || '').replace(/[^0-9]/g, '').slice(-10);
        if (digits === cleanPhone) {
          return {
            unique: false,
            field: 'phone',
            error: 'DUPLICATE_PHONE',
            message: `This mobile number (+91 ${cleanPhone}) is already registered to another account.`
          };
        }
      }
    }

    return { unique: true, isExistingUser: false };
  }

  createProfile(profile) {
    const cleanEmail = profile.email.trim().toLowerCase();
    const cleanPhone = '+91 ' + profile.phone.replace(/[^0-9]/g, '').slice(-10);
    const cleanName = profile.name.trim();
    const cleanDept = profile.dept || 'MIT School of Computing';

    const existing = this.getProfileByEmail(cleanEmail);
    if (existing) {
      this.db.prepare(`
        UPDATE profiles SET name = ?, phone = ?, dept = ? WHERE email = ? COLLATE NOCASE
      `).run(cleanName, cleanPhone, cleanDept, cleanEmail);
      return this.getProfileByEmail(cleanEmail);
    }

    const check = this.checkUniqueness(cleanName, cleanEmail, cleanPhone);
    if (!check.unique) {
      throw new Error(check.message);
    }

    const newId = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO profiles (id, name, email, phone, dept, is_verified, verified_at, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(newId, cleanName, cleanEmail, cleanPhone, cleanDept, now, now);

    return this.getProfileByEmail(cleanEmail);
  }

  // -----------------------------------------------------------------------
  // Rides API
  // -----------------------------------------------------------------------
  getRides() {
    const rows = this.db.prepare('SELECT * FROM rides ORDER BY created_at DESC').all();
    return rows.map(r => ({
      id: r.id,
      driverName: r.driver_name,
      driverEmail: r.driver_email,
      driverPhone: r.driver_phone,
      dept: r.dept,
      vehicle: r.vehicle,
      vehicleModel: r.vehicle_model,
      pickup: r.pickup,
      destination: r.destination,
      departureTime: r.departure_time,
      seatsTotal: r.seats_total,
      seatsLeft: r.seats_left,
      uberBenchmark: r.uber_benchmark,
      studentFare: r.student_fare,
      driverPayout: r.driver_payout,
      note: r.note,
      upiId: r.upi_id,
      createdAt: r.created_at
    }));
  }

  createRide(ride) {
    const count = this.db.prepare('SELECT COUNT(*) as count FROM rides').get().count;
    const newRide = {
      id: 'ride_' + (count + 1),
      driverName: ride.driverName,
      driverEmail: ride.driverEmail,
      driverPhone: ride.driverPhone,
      dept: ride.dept,
      vehicle: ride.vehicle,
      vehicleModel: ride.vehicleModel,
      pickup: ride.pickup,
      destination: ride.destination,
      departureTime: ride.departureTime,
      seatsTotal: ride.vehicle === 'Bike' ? 1 : ride.seatsTotal,
      seatsLeft: ride.vehicle === 'Bike' ? 1 : ride.seatsTotal,
      uberBenchmark: ride.uberBenchmark,
      studentFare: ride.studentFare,
      driverPayout: ride.driverPayout,
      note: ride.note || '',
      upiId: ride.upiId || '',
      createdAt: new Date().toISOString()
    };

    this.db.prepare(`
      INSERT INTO rides (
        id, driver_name, driver_email, driver_phone, dept, vehicle, vehicle_model,
        pickup, destination, departure_time, seats_total, seats_left,
        uber_benchmark, student_fare, driver_payout, note, upi_id, created_at
      ) VALUES (
        @id, @driverName, @driverEmail, @driverPhone, @dept, @vehicle, @vehicleModel,
        @pickup, @destination, @departureTime, @seatsTotal, @seatsLeft,
        @uberBenchmark, @studentFare, @driverPayout, @note, @upiId, @createdAt
      )
    `).run(newRide);

    return newRide;
  }

  // -----------------------------------------------------------------------
  // Bookings API (ACID Transactional Seat Decrement)
  // -----------------------------------------------------------------------
  bookRide({ rideId, passengerEmail, passengerName }) {
    const bookTx = this.db.transaction(() => {
      const ride = this.db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
      if (!ride) {
        throw new Error('Ride not found');
      }
      if (ride.seats_left <= 0) {
        throw new Error('Ride is fully booked');
      }
      if (ride.driver_email.toLowerCase() === passengerEmail.toLowerCase()) {
        throw new Error('Drivers cannot book seats on their own rides');
      }

      this.db.prepare('UPDATE rides SET seats_left = seats_left - 1 WHERE id = ?').run(rideId);

      const bookingId = 'BKG-' + Math.floor(1000 + Math.random() * 9000);
      const now = new Date().toISOString();

      const booking = {
        bookingId,
        rideId: ride.id,
        passengerEmail,
        passengerName,
        driverName: ride.driver_name,
        driverEmail: ride.driver_email,
        driverPhone: ride.driver_phone,
        dept: ride.dept,
        vehicleModel: ride.vehicle_model,
        pickup: ride.pickup,
        destination: ride.destination,
        departureTime: ride.departure_time,
        studentFare: ride.student_fare,
        paymentStatus: 'Pending',
        upiId: ride.upi_id,
        createdAt: now
      };

      this.db.prepare(`
        INSERT INTO bookings (
          booking_id, ride_id, passenger_email, passenger_name, driver_name,
          driver_email, driver_phone, dept, vehicle_model, pickup, destination,
          departure_time, student_fare, payment_status, upi_id, created_at
        ) VALUES (
          @bookingId, @rideId, @passengerEmail, @passengerName, @driverName,
          @driverEmail, @driverPhone, @dept, @vehicleModel, @pickup, @destination,
          @departureTime, @studentFare, @paymentStatus, @upiId, @createdAt
        )
      `).run(booking);

      return booking;
    });

    return bookTx();
  }

  getBookings() {
    const rows = this.db.prepare('SELECT * FROM bookings ORDER BY created_at DESC').all();
    return rows.map(r => ({
      bookingId: r.booking_id,
      rideId: r.ride_id,
      passengerEmail: r.passenger_email,
      passengerName: r.passenger_name,
      driverName: r.driver_name,
      driverEmail: r.driver_email,
      driverPhone: r.driver_phone,
      dept: r.dept,
      vehicleModel: r.vehicle_model,
      pickup: r.pickup,
      destination: r.destination,
      departureTime: r.departure_time,
      studentFare: r.student_fare,
      paymentStatus: r.payment_status,
      upiId: r.upi_id,
      createdAt: r.created_at
    }));
  }

  getBookingsByUser(email) {
    if (!email) return [];
    const cleanEmail = email.trim().toLowerCase();
    const rows = this.db.prepare(`
      SELECT * FROM bookings 
      WHERE passenger_email = ? COLLATE NOCASE OR driver_email = ? COLLATE NOCASE
      ORDER BY created_at DESC
    `).all(cleanEmail, cleanEmail);
    return rows.map(r => ({
      bookingId: r.booking_id,
      rideId: r.ride_id,
      passengerEmail: r.passenger_email,
      passengerName: r.passenger_name,
      driverName: r.driver_name,
      driverEmail: r.driver_email,
      driverPhone: r.driver_phone,
      dept: r.dept,
      vehicleModel: r.vehicle_model,
      pickup: r.pickup,
      destination: r.destination,
      departureTime: r.departure_time,
      studentFare: r.student_fare,
      paymentStatus: r.payment_status,
      upiId: r.upi_id,
      createdAt: r.created_at
    }));
  }

  getRidesByDriver(email) {
    if (!email) return [];
    const cleanEmail = email.trim().toLowerCase();
    const rows = this.db.prepare(`
      SELECT * FROM rides 
      WHERE driver_email = ? COLLATE NOCASE
      ORDER BY created_at DESC
    `).all(cleanEmail);
    return rows.map(r => ({
      id: r.id,
      driverName: r.driver_name,
      driverEmail: r.driver_email,
      driverPhone: r.driver_phone,
      dept: r.dept,
      vehicle: r.vehicle,
      vehicleModel: r.vehicle_model,
      pickup: r.pickup,
      destination: r.destination,
      departureTime: r.departure_time,
      seatsTotal: r.seats_total,
      seatsLeft: r.seats_left,
      uberBenchmark: r.uber_benchmark,
      studentFare: r.student_fare,
      driverPayout: r.driver_payout,
      note: r.note,
      upiId: r.upi_id,
      createdAt: r.created_at
    }));
  }

  updatePaymentStatus(bookingId, status) {
    const res = this.db.prepare(`
      UPDATE bookings SET payment_status = ? WHERE booking_id = ?
    `).run(status, bookingId);
    return res.changes > 0;
  }

  cancelBooking(bookingId, passengerEmail) {
    const cancelTx = this.db.transaction(() => {
      const booking = this.db.prepare('SELECT * FROM bookings WHERE booking_id = ?').get(bookingId);
      if (!booking) throw new Error('Booking not found');
      if (passengerEmail && booking.passenger_email.toLowerCase() !== passengerEmail.toLowerCase()) {
        throw new Error('Unauthorized to cancel this booking');
      }
      this.db.prepare('DELETE FROM bookings WHERE booking_id = ?').run(bookingId);
      this.db.prepare('UPDATE rides SET seats_left = MIN(seats_total, seats_left + 1) WHERE id = ?').run(booking.ride_id);
      return { success: true, rideId: booking.ride_id };
    });
    return cancelTx();
  }

  cancelRide(rideId, driverEmail) {
    const cancelTx = this.db.transaction(() => {
      const ride = this.db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
      if (!ride) throw new Error('Ride not found');
      if (driverEmail && ride.driver_email.toLowerCase() !== driverEmail.toLowerCase()) {
        throw new Error('Unauthorized to cancel this ride');
      }
      this.db.prepare('DELETE FROM bookings WHERE ride_id = ?').run(rideId);
      this.db.prepare('DELETE FROM rides WHERE id = ?').run(rideId);
      return { success: true };
    });
    return cancelTx();
  }

  // -----------------------------------------------------------------------
  // Driver Platform Commission Settlement & User Clearance API
  // -----------------------------------------------------------------------
  getDriverSettledAmount(email) {
    if (!email) return 0;
    const cleanEmail = email.trim().toLowerCase();
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM driver_settlements 
      WHERE driver_email = ? COLLATE NOCASE
    `).get(cleanEmail);
    return row ? Number(row.total) : 0;
  }

  recordDriverSettlement(email, amount) {
    if (!email || amount <= 0) return { success: false, message: 'Invalid settlement amount' };
    const cleanEmail = email.trim().toLowerCase();
    const id = 'SETTLE-' + crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO driver_settlements (id, driver_email, amount, settled_at)
      VALUES (?, ?, ?, ?)
    `).run(id, cleanEmail, amount, now);
    return { success: true, id, amount, settledAt: now };
  }

  getDriverCommissionDue(email) {
    if (!email) return { totalRides: 0, grossFare: 0, totalCommission: 0, settled: 0, netDue: 0 };
    const cleanEmail = email.trim().toLowerCase();
    const rides = this.db.prepare(`
      SELECT seats_total, seats_left, student_fare 
      FROM rides 
      WHERE driver_email = ? COLLATE NOCASE
    `).all(cleanEmail);

    let totalRides = 0;
    let grossFare = 0;
    let totalCommission = 0;

    for (const r of rides) {
      const seatsSold = r.seats_total - r.seats_left;
      if (seatsSold > 0) {
        const rideGross = seatsSold * r.student_fare;
        const comm = Math.round(rideGross * 0.10);
        totalRides += seatsSold;
        grossFare += rideGross;
        totalCommission += comm;
      }
    }

    const settled = this.getDriverSettledAmount(cleanEmail);
    const netDue = Math.max(0, totalCommission - settled);

    return { totalRides, grossFare, totalCommission, settled, netDue };
  }

  getPassengerPendingBookings(email) {
    if (!email) return [];
    const cleanEmail = email.trim().toLowerCase();
    const rows = this.db.prepare(`
      SELECT * FROM bookings 
      WHERE passenger_email = ? COLLATE NOCASE AND payment_status = 'Pending'
      ORDER BY created_at DESC
    `).all(cleanEmail);
    return rows.map(r => ({
      bookingId: r.booking_id,
      rideId: r.ride_id,
      passengerEmail: r.passenger_email,
      passengerName: r.passenger_name,
      driverName: r.driver_name,
      driverEmail: r.driver_email,
      studentFare: r.student_fare,
      pickup: r.pickup,
      destination: r.destination,
      departureTime: r.departure_time,
      paymentStatus: r.payment_status
    }));
  }

  checkUserSettlementBlock(email) {
    if (!email) return { isBlocked: false, reason: 'NONE' };
    const cleanEmail = email.trim().toLowerCase();
    const driverComm = this.getDriverCommissionDue(cleanEmail);
    const pendingBookings = this.getPassengerPendingBookings(cleanEmail);

    const hasUnsettledCommission = driverComm.netDue > 0;
    const hasUnpaidBooking = pendingBookings.length > 0;
    const isBlocked = hasUnsettledCommission || hasUnpaidBooking;

    let reason = 'NONE';
    if (hasUnsettledCommission) reason = 'COMMISSION_DUE';
    else if (hasUnpaidBooking) reason = 'UNPAID_BOOKING';

    return {
      isBlocked,
      hasUnsettledCommission,
      hasUnpaidBooking,
      commissionDue: driverComm.netDue,
      driverCommission: driverComm,
      pendingBookings,
      reason
    };
  }

  // -----------------------------------------------------------------------
  // OTP Verification API
  // -----------------------------------------------------------------------
  getOtps() {
    const rows = this.db.prepare('SELECT * FROM otp_verifications').all();
    return rows.map(r => ({
      id: r.id,
      identifier: r.identifier,
      type: r.type,
      hashedOtp: r.hashed_otp,
      attemptsLeft: r.attempts_left,
      expiresAt: r.expires_at,
      resendCooldownUntil: r.resend_cooldown_until,
      isVerified: Boolean(r.is_verified),
      token: r.token,
      createdAt: r.created_at
    }));
  }

  saveOtp(record) {
    this.db.prepare(`
      INSERT OR REPLACE INTO otp_verifications (
        id, identifier, type, hashed_otp, attempts_left, expires_at,
        resend_cooldown_until, is_verified, token, created_at
      ) VALUES (
        @id, @identifier, @type, @hashedOtp, @attemptsLeft, @expiresAt,
        @resendCooldownUntil, @isVerified, @token, @createdAt
      )
    `).run({
      id: record.id || crypto.randomUUID(),
      identifier: record.identifier.toLowerCase(),
      type: record.type,
      hashedOtp: record.hashedOtp,
      attemptsLeft: record.attemptsLeft ?? 5,
      expiresAt: record.expiresAt,
      resendCooldownUntil: record.resendCooldownUntil || 0,
      isVerified: record.isVerified ? 1 : 0,
      token: record.token || null,
      createdAt: record.createdAt || Date.now()
    });
  }

  cleanExpiredOtps(identifier) {
    const now = Date.now();
    if (identifier) {
      this.db.prepare('DELETE FROM otp_verifications WHERE identifier = ? AND expires_at <= ?').run(identifier.toLowerCase(), now);
    } else {
      this.db.prepare('DELETE FROM otp_verifications WHERE expires_at <= ?').run(now);
    }
  }

  findOtp(identifier, type) {
    if (!identifier) return null;
    const r = this.db.prepare(`
      SELECT * FROM otp_verifications 
      WHERE identifier = ? COLLATE NOCASE AND type = ? 
      ORDER BY created_at DESC LIMIT 1
    `).get(identifier.trim().toLowerCase(), type);
    if (!r) return null;
    return {
      id: r.id,
      identifier: r.identifier,
      type: r.type,
      hashedOtp: r.hashed_otp,
      attemptsLeft: r.attempts_left,
      expiresAt: r.expires_at,
      resendCooldownUntil: r.resend_cooldown_until,
      isVerified: Boolean(r.is_verified),
      token: r.token,
      createdAt: r.created_at
    };
  }

  findOtpByToken(identifier, token) {
    if (!identifier || !token) return null;
    const r = this.db.prepare(`
      SELECT * FROM otp_verifications 
      WHERE identifier = ? COLLATE NOCASE AND token = ? AND is_verified = 1
      ORDER BY created_at DESC LIMIT 1
    `).get(identifier.trim().toLowerCase(), token);
    if (!r) return null;
    return {
      id: r.id,
      identifier: r.identifier,
      type: r.type,
      token: r.token,
      isVerified: Boolean(r.is_verified)
    };
  }

  // -----------------------------------------------------------------------
  // Backward Compatibility & Proxy Layer for Server.js
  // -----------------------------------------------------------------------
  save() {
    // No-op: SQLite writes directly to disk on every statement
  }

  get data() {
    const self = this;
    return {
      get profiles() {
        return self.getProfiles();
      },
      get rides() {
        return self.getRides();
      },
      get bookings() {
        return self.getBookings();
      },
      get otpVerifications() {
        return self.getOtps();
      },
      set otpVerifications(val) {
        // When server.js filters OTPs (e.g. removing expired)
        // Clean up expired in SQLite
        self.cleanExpiredOtps();
      }
    };
  }
}

module.exports = SQLiteCampusDatabase;
