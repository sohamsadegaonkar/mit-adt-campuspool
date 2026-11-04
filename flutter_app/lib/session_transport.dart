import 'session_transport_base.dart';
import 'session_transport_io.dart'
    if (dart.library.js_interop) 'session_transport_web.dart' as platform;

/// Platform-selected transport; Flutter Web is always same origin, while
/// Android/iOS use a memory-only native cookie that is never persisted.
CampusSessionClient createCampusSessionClient(Uri origin) =>
    platform.makeCampusSessionClient(origin);
