# Fiche Play Store : Scuba See Red

À copier dans la Play Console. Les limites de longueur sont celles de Google.

## Visuels

- Icône 512 × 512 : `store/icon-512.png`
- Bannière 1024 × 500 : `store/feature-graphic.png`
- Captures d'écran : à prendre sur un téléphone, avec une vraie plongée (2 au minimum)

## Détails de l'application

**Nom (30 caractères au maximum)**

Scuba See Red

**Description courte (80 caractères au maximum)**

Redonnez leurs couleurs à vos vidéos et photos de plongée, sans rien envoyer.

**Description complète (4 000 caractères au maximum)**

Sous l'eau, le rouge disparaît dès les premiers mètres : vos images deviennent bleues ou vertes. Scuba See Red corrige cette dominante et redonne leurs couleurs aux coraux, aux poissons et aux plongeurs.

Tout se passe sur votre téléphone. Pas de compte, pas de publicité, et vos fichiers ne sont envoyés nulle part.

COULEURS
• Correction automatique, conçue pour l'image sous-marine
• Préréglages selon le type d'eau, dont un pour l'eau verte des lacs et des ports
• Réglages fins : récupération du rouge, saturation, luminosité
• Comparaison avant/après en glissant le doigt sur l'image

VIDÉOS
• Stabilisation pour atténuer le palmage et la houle
• Export d'une vidéo entière ou d'un extrait seulement
• Traitement de plusieurs vidéos à la suite avec les mêmes réglages
• Son d'origine conservé avec la conversion rapide (fichiers MP4 et MOV)

PHOTOS
• Correction de vos photos de plongée, exportées en JPEG
• Extraction d'une photo en pleine résolution depuis n'importe quel moment d'une vidéo

CADRAGE
• Formats de recadrage, dont le format vertical
• Rotation et miroir
• Suivi du sujet : entourez un poisson ou un plongeur et le cadre le suit, même lorsque sa forme change

BON À SAVOIR
• Le suivi du sujet demande une analyse de la vidéo, qui peut durer plusieurs minutes sur une longue séquence. Gardez l'application ouverte pendant l'analyse et l'export.
• Au-delà de 20 m sans éclairage, le rouge est presque absent de l'image : la correction a ses limites et l'image peut devenir bruitée.
• Compatible avec Android 10 et les versions ultérieures.

## Classement

- Type : application
- Catégorie : Vidéo et montage (à confirmer selon la liste de la console)
- Éditeur : ICUDROID
- Contact public : icudroid@gmail.com

## Contenu de l'application

| Question | Réponse | Pourquoi |
|---|---|---|
| Politique de confidentialité | URL publique de `store/privacy-policy.html` | À héberger, le fichier seul ne suffit pas |
| Publicités | Non | Aucun SDK publicitaire |
| Accès à l'application | Toutes les fonctions sont accessibles sans restriction | Aucun compte |
| Public cible | 18 ans et plus, à confirmer | Rien n'est destiné aux enfants ; cet âge simplifie le formulaire |
| Actualités, santé, finance, jeux d'argent | Non | Sans objet |
| Application gouvernementale | Non | Sans objet |
| Classification du contenu | Répondre « Non » aux questions sur la violence, le sexe, les jeux d'argent et les échanges entre utilisateurs | L'application ne contient ni ne diffuse aucun contenu de ce type |

## Sécurité des données

Google appelle « collecte » la transmission de données hors de l'appareil. Le code n'en fait aucune.

| Question | Réponse |
|---|---|
| L'application collecte-t-elle ou partage-t-elle des données obligatoires ? | Non |
| Types de données | Aucun |

Ces points ont été contrôlés dans le code le 6 novembre 2026, à refaire si l'application évolue :

- Aucune adresse externe dans `lib/` ni dans le moteur, dont la politique de sécurité (CSP) limite les ressources à l'application.
- Le serveur local n'écoute que sur 127.0.0.1, derrière un jeton aléatoire. C'est la seule raison de la permission `INTERNET`.
- Aucun SDK d'analyse, de publicité ou de rapport de plantage dans les dépendances.
- Les autres permissions du manifeste (`ACCESS_NETWORK_STATE`, `WAKE_LOCK`) viennent des plugins.

Le partage vers une autre application n'est pas une collecte : c'est l'utilisateur qui le déclenche, et il choisit la destination.
