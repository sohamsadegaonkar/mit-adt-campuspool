import 'package:flutter/material.dart';

import 'app.dart';
import 'theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const CampusPoolApp());
}

class CampusPoolApp extends StatelessWidget {
  const CampusPoolApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'CampusPool',
      debugShowCheckedModeBanner: false,
      theme: CpTheme.data,
      home: const CampusShell(),
    );
  }
}
