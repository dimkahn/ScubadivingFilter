import 'dart:io';

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../theme.dart';

/// Les visionneuses restent sombres quel que soit le thème : on juge une image sur fond noir.
final _viewerTheme = ThemeData(
  useMaterial3: true,
  brightness: Brightness.dark,
  fontFamily: 'Plex',
  scaffoldBackgroundColor: Colors.black,
  colorScheme: ColorScheme.dark(primary: darkPalette.accent, surface: Colors.black, onSurface: darkPalette.fg),
  appBarTheme: AppBarTheme(backgroundColor: Colors.black, foregroundColor: darkPalette.fg),
);

/// Résultat d'un export de photo : on peut zoomer pour juger de la correction.
class PhotoViewer extends StatelessWidget {
  const PhotoViewer({super.key, required this.file, required this.title});
  final File file;
  final String title;

  @override
  Widget build(BuildContext context) => Theme(
    data: _viewerTheme,
    child: Scaffold(
      appBar: AppBar(
        title: Text(
          title,
          style: T.body(15, wght: 500, color: darkPalette.fg),
          overflow: TextOverflow.ellipsis,
        ),
      ),
      body: InteractiveViewer(maxScale: 8, child: Center(child: Image.file(file))),
    ),
  );
}

/// Lecture plein écran d'une vidéo exportée, pour vérifier le résultat avant de l'enregistrer.

class ResultPlayer extends StatefulWidget {
  const ResultPlayer({super.key, required this.file, required this.title});
  final File file;
  final String title;

  @override
  State<ResultPlayer> createState() => _ResultPlayerState();
}

class _ResultPlayerState extends State<ResultPlayer> {
  late final VideoPlayerController _c = VideoPlayerController.file(widget.file);
  String? _error;

  @override
  void initState() {
    super.initState();
    _c
        .initialize()
        .then((_) {
          if (!mounted) return;
          setState(() {});
          _c.play();
        })
        .catchError((Object e) {
          if (mounted) setState(() => _error = '$e');
        });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: _viewerTheme,
      child: Scaffold(
        appBar: AppBar(
          title: Text(
            widget.title,
            style: T.body(15, wght: 500, color: darkPalette.fg),
            overflow: TextOverflow.ellipsis,
          ),
        ),
        body: _error != null
            ? Center(
                child: Padding(padding: const EdgeInsets.all(24), child: Text('Lecture impossible : $_error')),
              )
            : !_c.value.isInitialized
            ? const Center(child: CircularProgressIndicator())
            : SafeArea(
                child: Column(
                  children: [
                    Expanded(
                      child: Center(
                        child: AspectRatio(
                          aspectRatio: _c.value.aspectRatio,
                          child: GestureDetector(
                            onTap: () => setState(() => _c.value.isPlaying ? _c.pause() : _c.play()),
                            child: VideoPlayer(_c),
                          ),
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: VideoProgressIndicator(
                        _c,
                        allowScrubbing: true,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        colors: VideoProgressColors(playedColor: darkPalette.accent),
                      ),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}
