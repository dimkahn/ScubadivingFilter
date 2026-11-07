/// Types de fichiers : une seule liste pour l'application et le serveur local.
///
/// Images que le moteur ouvre comme photos (élément `<img>` de la WebView). Tout le reste est traité en vidéo.
const imageMimeTypes = {
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'webp': 'image/webp',
  'heic': 'image/heic',
  'heif': 'image/heif',
  'avif': 'image/avif',
  'gif': 'image/gif',
  'bmp': 'image/bmp',
};

/// Extension en minuscules, sans le point ('' s'il n'y en a pas).
String extensionOf(String name) {
  final dot = name.lastIndexOf('.');
  return dot <= 0 || dot == name.length - 1 ? '' : name.substring(dot + 1).toLowerCase();
}

/// Nom sans son extension. Un nom qui commence par un point (« .video ») est gardé entier.
String baseNameOf(String name) {
  final dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.substring(0, dot);
}

bool isImageName(String name) => imageMimeTypes.containsKey(extensionOf(name));
