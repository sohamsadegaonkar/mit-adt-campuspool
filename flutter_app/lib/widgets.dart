import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'theme.dart';

class CampusMark extends StatelessWidget {
  const CampusMark({super.key, this.size = 38});
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size, height: size,
    decoration: BoxDecoration(color: CpColors.yellow,
      borderRadius: BorderRadius.circular(size * .28)),
    child: Icon(Icons.alt_route_rounded, color: CpColors.ink, size: size * .59),
  );
}

class CampusButton extends StatelessWidget {
  const CampusButton({super.key, required this.label, required this.onPressed,
    this.primary = true, this.icon});
  final String label;
  final VoidCallback? onPressed;
  final bool primary;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 50,
    child: FilledButton(
      onPressed: onPressed,
      style: FilledButton.styleFrom(
        backgroundColor: primary ? CpColors.yellow : CpColors.surface,
        foregroundColor: CpColors.ink,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        padding: const EdgeInsets.symmetric(horizontal: 10),
      ),
      child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        if (icon != null) ...[Icon(icon, size: 18), const SizedBox(width: 6)],
        Flexible(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center, style: const TextStyle(
              fontSize: 13, fontWeight: FontWeight.w700))),
      ]),
    ),
  );
}

class CampusPanel extends StatelessWidget {
  const CampusPanel({super.key, required this.child,
    this.color = CpColors.surface, this.padding = const EdgeInsets.all(16)});
  final Widget child;
  final Color color;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(14)),
    child: Padding(padding: padding, child: child),
  );
}

class CampusNote extends StatelessWidget {
  const CampusNote({super.key, required this.message, this.icon = Icons.shield_outlined});
  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) => CampusPanel(
    color: const Color(0xFFFFF8DF),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Icon(icon, size: 20, color: CpColors.warning),
      const SizedBox(width: 11),
      Expanded(child: Text(message, style: const TextStyle(
        color: CpColors.warning, fontSize: 12, height: 1.5))),
    ]),
  );
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.title, {super.key});
  final String title;
  @override
  Widget build(BuildContext context) => Text(title,
      style: Theme.of(context).textTheme.titleLarge);
}

/// Editable vector-like route illustration; deliberately NOT real campus imagery.
class CampusRouteArt extends StatelessWidget {
  const CampusRouteArt({super.key, this.height = 192});
  final double height;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(16),
    child: ColoredBox(
      color: const Color(0xFFE9EEE6),
      child: SizedBox(height: height, width: double.infinity,
        child: CustomPaint(painter: _RoutePainter())),
    ),
  );
}

class _RoutePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final sx = size.width / 342;
    final sy = size.height / 164;
    canvas.save();
    canvas.scale(sx, sy);
    final road = Paint()..color = Colors.white..strokeWidth = 12
      ..style = PaintingStyle.stroke..strokeCap = StrokeCap.round;
    final shadow = Paint()..color = const Color(0xFFD8E0D6)
      ..strokeWidth = 20..style = PaintingStyle.stroke;
    for (final x in [45.0, 158.0, 269.0]) {
      final path = Path()..moveTo(x, 0)..lineTo(x, 164);
      canvas.drawPath(path, shadow);
      canvas.drawPath(path, road);
    }
    for (final y in [41.0, 114.0]) {
      final path = Path()..moveTo(0, y)..lineTo(342, y);
      canvas.drawPath(path, shadow);
      canvas.drawPath(path, road);
    }
    final path = Path()
      ..moveTo(30, 142)
      ..cubicTo(93, 132, 91, 43, 164, 65)
      ..cubicTo(237, 97, 265, 101, 310, 24);
    canvas.drawPath(path, Paint()..color = CpColors.ink..strokeWidth = 5
      ..style = PaintingStyle.stroke..strokeCap = StrokeCap.round);
    final dotted = Paint()..color = CpColors.yellow..strokeWidth = 3
      ..style = PaintingStyle.stroke..strokeCap = StrokeCap.round;
    for (double t = 0; t <= 1.0; t += .055) {
      // Separate short route dashes, not a fabricated geographic route.
      final pt = _cubicPoint(t);
      final next = _cubicPoint(math.min(t + .025, 1));
      canvas.drawLine(pt, next, dotted);
    }
    canvas.drawCircle(const Offset(30, 142), 10,
      Paint()..color = Colors.white);
    canvas.drawCircle(const Offset(30, 142), 10,
      Paint()..color = CpColors.ink..style = PaintingStyle.stroke..strokeWidth = 3);
    canvas.drawCircle(const Offset(310, 24), 10, Paint()..color = CpColors.yellow);
    canvas.drawCircle(const Offset(310, 24), 10,
      Paint()..color = CpColors.ink..style = PaintingStyle.stroke..strokeWidth = 3);
    canvas.restore();
  }

  Offset _cubicPoint(double t) {
    // A smooth illustrative path closely following the Figma route motif.
    const a = Offset(30, 142);
    const b = Offset(110, 120);
    const c = Offset(215, 142);
    const d = Offset(310, 24);
    final u = 1 - t;
    return a * (u * u * u) + b * (3 * u * u * t) +
        c * (3 * u * t * t) + d * (t * t * t);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
