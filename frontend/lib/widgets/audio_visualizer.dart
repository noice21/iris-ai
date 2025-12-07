import 'dart:math';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';

/// Animated gradient background with aurora/anime style effects
class AnimatedGradientBackground extends StatefulWidget {
  final Widget child;
  final bool isActive;
  final Color accentColor;

  const AnimatedGradientBackground({
    super.key,
    required this.child,
    this.isActive = false,
    this.accentColor = Colors.purple,
  });

  @override
  State<AnimatedGradientBackground> createState() =>
      _AnimatedGradientBackgroundState();
}

class _AnimatedGradientBackgroundState extends State<AnimatedGradientBackground>
    with TickerProviderStateMixin {
  late AnimationController _controller;
  late AnimationController _waveController;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 8),
    )..repeat();

    _waveController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 3),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    _waveController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Listenable.merge([_controller, _waveController]),
      builder: (context, child) {
        return CustomPaint(
          painter: _AuroraBackgroundPainter(
            animation: _controller.value,
            waveAnimation: _waveController.value,
            isActive: widget.isActive,
            accentColor: widget.accentColor,
          ),
          child: widget.child,
        );
      },
    );
  }
}

class _AuroraBackgroundPainter extends CustomPainter {
  final double animation;
  final double waveAnimation;
  final bool isActive;
  final Color accentColor;

  _AuroraBackgroundPainter({
    required this.animation,
    required this.waveAnimation,
    required this.isActive,
    required this.accentColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    // Base dark gradient
    final baseGradient = ui.Gradient.linear(
      Offset.zero,
      Offset(size.width, size.height),
      [
        const Color(0xFF0a0a1a),
        const Color(0xFF1a1a3e),
        const Color(0xFF0d0d2b),
      ],
      [0.0, 0.5, 1.0],
    );

    canvas.drawRect(
      Rect.fromLTWH(0, 0, size.width, size.height),
      Paint()..shader = baseGradient,
    );

    // Animated aurora blobs
    final blobPaint = Paint()..maskFilter = const MaskFilter.blur(BlurStyle.normal, 80);

    // First blob - purple/pink
    final blob1X = size.width * (0.3 + 0.2 * sin(animation * 2 * pi));
    final blob1Y = size.height * (0.3 + 0.15 * cos(animation * 2 * pi * 0.7));
    blobPaint.shader = ui.Gradient.radial(
      Offset(blob1X, blob1Y),
      size.width * 0.4,
      [
        accentColor.withValues(alpha: isActive ? 0.4 : 0.2),
        accentColor.withValues(alpha: 0.0),
      ],
    );
    canvas.drawCircle(Offset(blob1X, blob1Y), size.width * 0.4, blobPaint);

    // Second blob - cyan/blue
    final blob2X = size.width * (0.7 + 0.2 * cos(animation * 2 * pi * 0.8));
    final blob2Y = size.height * (0.6 + 0.2 * sin(animation * 2 * pi * 0.6));
    blobPaint.shader = ui.Gradient.radial(
      Offset(blob2X, blob2Y),
      size.width * 0.35,
      [
        const Color(0xFF00d4ff).withValues(alpha: isActive ? 0.3 : 0.15),
        const Color(0xFF00d4ff).withValues(alpha: 0.0),
      ],
    );
    canvas.drawCircle(Offset(blob2X, blob2Y), size.width * 0.35, blobPaint);

    // Third blob - pink/magenta (more visible when active)
    final blob3X = size.width * (0.5 + 0.3 * sin(animation * 2 * pi * 1.2));
    final blob3Y = size.height * (0.7 + 0.1 * cos(animation * 2 * pi));
    blobPaint.shader = ui.Gradient.radial(
      Offset(blob3X, blob3Y),
      size.width * 0.3,
      [
        const Color(0xFFff00ff).withValues(alpha: isActive ? 0.25 : 0.1),
        const Color(0xFFff00ff).withValues(alpha: 0.0),
      ],
    );
    canvas.drawCircle(Offset(blob3X, blob3Y), size.width * 0.3, blobPaint);

    // Subtle particle/star effect
    final starPaint = Paint()..color = Colors.white.withValues(alpha: 0.3);
    final random = Random(42);
    for (int i = 0; i < 50; i++) {
      final x = random.nextDouble() * size.width;
      final y = random.nextDouble() * size.height;
      final twinkle = (sin((animation + i * 0.1) * 2 * pi) + 1) / 2;
      starPaint.color = Colors.white.withValues(alpha: 0.1 + twinkle * 0.3);
      canvas.drawCircle(Offset(x, y), 1 + twinkle, starPaint);
    }
  }

  @override
  bool shouldRepaint(covariant _AuroraBackgroundPainter oldDelegate) {
    return animation != oldDelegate.animation ||
        waveAnimation != oldDelegate.waveAnimation ||
        isActive != oldDelegate.isActive ||
        accentColor != oldDelegate.accentColor;
  }
}

class AudioVisualizer extends StatefulWidget {
  final double amplitude;
  final bool isActive;
  final Color color;
  final int barCount;

  const AudioVisualizer({
    super.key,
    this.amplitude = 0.0,
    this.isActive = false,
    this.color = Colors.blue,
    this.barCount = 5,
  });

  @override
  State<AudioVisualizer> createState() => _AudioVisualizerState();
}

class _AudioVisualizerState extends State<AudioVisualizer>
    with TickerProviderStateMixin {
  late AnimationController _controller;
  final Random _random = Random();

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 150),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(widget.barCount, (index) {
            final baseHeight = widget.isActive
                ? widget.amplitude * 0.5 + _random.nextDouble() * 0.5
                : 0.1;
            return _buildBar(baseHeight);
          }),
        );
      },
    );
  }

  Widget _buildBar(double heightFactor) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 100),
      margin: const EdgeInsets.symmetric(horizontal: 2),
      width: 4,
      height: 40 * heightFactor.clamp(0.1, 1.0),
      decoration: BoxDecoration(
        color: widget.color,
        borderRadius: BorderRadius.circular(2),
      ),
    );
  }
}

class CircularAudioVisualizer extends StatefulWidget {
  final double amplitude;
  final bool isActive;
  final Color color;
  final double size;

  const CircularAudioVisualizer({
    super.key,
    this.amplitude = 0.0,
    this.isActive = false,
    this.color = Colors.blue,
    this.size = 150,
  });

  @override
  State<CircularAudioVisualizer> createState() => _CircularAudioVisualizerState();
}

class _CircularAudioVisualizerState extends State<CircularAudioVisualizer>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final scale = widget.isActive
            ? 1.0 + (widget.amplitude * 0.3)
            : 1.0;

        return Transform.scale(
          scale: scale,
          child: Container(
            width: widget.size,
            height: widget.size,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: RadialGradient(
                colors: [
                  widget.color.withValues(alpha: 0.8),
                  widget.color.withValues(alpha: 0.4),
                  widget.color.withValues(alpha: 0.1),
                ],
              ),
              boxShadow: widget.isActive
                  ? [
                      BoxShadow(
                        color: widget.color.withValues(alpha: 0.5),
                        blurRadius: 20 + (widget.amplitude * 30),
                        spreadRadius: widget.amplitude * 10,
                      ),
                    ]
                  : null,
            ),
            child: Center(
              child: Icon(
                widget.isActive ? Icons.mic : Icons.mic_none,
                size: widget.size * 0.4,
                color: Colors.white,
              ),
            ),
          ),
        );
      },
    );
  }
}

class WaveformVisualizer extends StatelessWidget {
  final List<double> waveformData;
  final Color color;
  final double height;

  const WaveformVisualizer({
    super.key,
    required this.waveformData,
    this.color = Colors.blue,
    this.height = 100,
  });

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size(double.infinity, height),
      painter: _WaveformPainter(
        waveformData: waveformData,
        color: color,
      ),
    );
  }
}

class _WaveformPainter extends CustomPainter {
  final List<double> waveformData;
  final Color color;

  _WaveformPainter({
    required this.waveformData,
    required this.color,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (waveformData.isEmpty) return;

    final paint = Paint()
      ..color = color
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    final path = Path();
    final midY = size.height / 2;
    final stepX = size.width / (waveformData.length - 1);

    path.moveTo(0, midY + (waveformData[0] * midY));

    for (int i = 1; i < waveformData.length; i++) {
      final x = i * stepX;
      final y = midY + (waveformData[i] * midY);
      path.lineTo(x, y);
    }

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _WaveformPainter oldDelegate) {
    return waveformData != oldDelegate.waveformData;
  }
}

/// Full-screen sound wave visualizer for minimalist mode - mirrored style with glow
class SoundWaveVisualizer extends StatefulWidget {
  final bool isActive;
  final bool isSpeaking;
  final Color color;
  final int barCount;

  const SoundWaveVisualizer({
    super.key,
    this.isActive = false,
    this.isSpeaking = false,
    this.color = Colors.blue,
    this.barCount = 40,
  });

  @override
  State<SoundWaveVisualizer> createState() => _SoundWaveVisualizerState();
}

class _SoundWaveVisualizerState extends State<SoundWaveVisualizer>
    with TickerProviderStateMixin {
  late AnimationController _controller;
  late AnimationController _glowController;
  final Random _random = Random();
  late List<double> _barHeights;
  late List<double> _targetHeights;
  late List<double> _velocities;

  @override
  void initState() {
    super.initState();
    _barHeights = List.generate(widget.barCount, (_) => 0.1);
    _targetHeights = List.generate(widget.barCount, (_) => 0.1);
    _velocities = List.generate(widget.barCount, (_) => 0.0);

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 50),
    )..addListener(_updateBars);
    _controller.repeat();

    _glowController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2000),
    )..repeat(reverse: true);
  }

  void _updateBars() {
    if (!mounted) return;
    setState(() {
      for (int i = 0; i < widget.barCount; i++) {
        if (widget.isActive) {
          // Wave-like pattern when active
          final wave = sin((i / widget.barCount) * pi * 2 + _controller.value * pi * 4);
          if (_random.nextDouble() > 0.6) {
            _targetHeights[i] = 0.3 + _random.nextDouble() * 0.7 + wave * 0.1;
          }
        } else {
          // Gentle idle animation
          final idleWave = sin((i / widget.barCount) * pi * 2 + _glowController.value * pi * 2);
          _targetHeights[i] = 0.08 + idleWave * 0.04 + _random.nextDouble() * 0.03;
        }

        // Spring physics for smoother motion
        final force = (_targetHeights[i] - _barHeights[i]) * 0.4;
        _velocities[i] = _velocities[i] * 0.7 + force;
        _barHeights[i] += _velocities[i];
        _barHeights[i] = _barHeights[i].clamp(0.05, 1.0);
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _glowController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return CustomPaint(
          size: Size(constraints.maxWidth, constraints.maxHeight),
          painter: _WaveVisualizerPainter(
            barHeights: _barHeights,
            color: widget.color,
            isActive: widget.isActive,
            glowIntensity: _glowController.value,
          ),
        );
      },
    );
  }
}

class _WaveVisualizerPainter extends CustomPainter {
  final List<double> barHeights;
  final Color color;
  final bool isActive;
  final double glowIntensity;

  _WaveVisualizerPainter({
    required this.barHeights,
    required this.color,
    required this.isActive,
    required this.glowIntensity,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final barCount = barHeights.length;
    final barWidth = size.width / (barCount * 2.2);
    final maxBarHeight = size.height * 0.35;
    final centerY = size.height / 2;

    // Draw glow layer first
    if (isActive) {
      final glowPaint = Paint()
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 20);

      for (int i = 0; i < barCount; i++) {
        final x = (size.width - barCount * barWidth * 2.2) / 2 + i * barWidth * 2.2 + barWidth / 2;
        final height = barHeights[i] * maxBarHeight;

        glowPaint.shader = ui.Gradient.linear(
          Offset(x, centerY - height),
          Offset(x, centerY + height),
          [
            color.withValues(alpha: 0.0),
            color.withValues(alpha: 0.4 * glowIntensity),
            color.withValues(alpha: 0.0),
          ],
          [0.0, 0.5, 1.0],
        );

        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromCenter(center: Offset(x, centerY), width: barWidth * 1.5, height: height * 2.2),
            Radius.circular(barWidth),
          ),
          glowPaint,
        );
      }
    }

    // Draw main bars with gradient
    for (int i = 0; i < barCount; i++) {
      final x = (size.width - barCount * barWidth * 2.2) / 2 + i * barWidth * 2.2 + barWidth / 2;
      final height = barHeights[i] * maxBarHeight;
      final opacity = isActive ? 1.0 : 0.6;

      // Create gradient for each bar
      final barPaint = Paint()
        ..shader = ui.Gradient.linear(
          Offset(x, centerY - height),
          Offset(x, centerY + height),
          [
            color.withValues(alpha: opacity * 0.3),
            color.withValues(alpha: opacity),
            color.withValues(alpha: opacity),
            color.withValues(alpha: opacity * 0.3),
          ],
          [0.0, 0.3, 0.7, 1.0],
        );

      // Draw mirrored bar (top and bottom from center)
      final rect = RRect.fromRectAndRadius(
        Rect.fromCenter(center: Offset(x, centerY), width: barWidth, height: height * 2),
        Radius.circular(barWidth / 2),
      );
      canvas.drawRRect(rect, barPaint);

      // Add subtle highlight
      if (isActive && barHeights[i] > 0.5) {
        final highlightPaint = Paint()
          ..color = Colors.white.withValues(alpha: 0.3 * (barHeights[i] - 0.5) * 2)
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 2);

        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromCenter(center: Offset(x, centerY), width: barWidth * 0.5, height: height * 1.5),
            Radius.circular(barWidth / 4),
          ),
          highlightPaint,
        );
      }
    }

    // Draw center line glow when active
    if (isActive) {
      final linePaint = Paint()
        ..color = color.withValues(alpha: 0.3 * glowIntensity)
        ..strokeWidth = 2
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4);
      canvas.drawLine(
        Offset(0, centerY),
        Offset(size.width, centerY),
        linePaint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _WaveVisualizerPainter oldDelegate) {
    return true; // Always repaint for smooth animation
  }
}
