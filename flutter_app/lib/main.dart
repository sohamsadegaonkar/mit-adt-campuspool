import 'package:flutter/material.dart';

import 'app.dart';
import 'campus_runtime.dart';
import 'theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final runtime = CampusRuntime.fromEnvironment();
  runApp(CampusPoolApp(runtime: runtime));
}

class CampusPoolApp extends StatefulWidget {
  const CampusPoolApp({super.key, this.runtime});

  /// Omit runtime for the deliberately offline guest-design preview.
  final CampusRuntime? runtime;

  @override
  State<CampusPoolApp> createState() => _CampusPoolAppState();
}

class _CampusPoolAppState extends State<CampusPoolApp> {
  @override
  void dispose() {
    widget.runtime?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'CampusPool',
    debugShowCheckedModeBanner: false,
    theme: CpTheme.data,
    home: CampusShell(
      auth: widget.runtime?.auth,
      rideSource: widget.runtime?.rideSource,
    ),
  );
}
