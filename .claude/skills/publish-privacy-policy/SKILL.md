---
name: publish-privacy-policy
description: Met en ligne store/privacy-policy.html sur GitHub Pages (branche gh-pages) et vérifie la page publique. À utiliser après une modification de la politique de confidentialité, ou quand l'utilisateur demande de la publier ou de vérifier qu'elle est en ligne.
---

# Publier la politique de confidentialité

Adresse publique (déclarée dans la Play Console) :
https://dimkahn.github.io/ScubadivingFilter/privacy-policy.html

La branche `gh-pages` ne contient que `.nojekyll` et `privacy-policy.html`, sans historique commun avec le code.

## Étapes

1. **Contrôler** `store/privacy-policy.html` : aucun texte à compléter (`grep -c '\[NOM\|\[ADRESSE'` → 0), date de
   « Dernière mise à jour » à jour, contact `icudroid@gmail.com`.
2. **Construire le commit** sans toucher à l'arbre de travail, avec l'identité publique :

```bash
cd "$CLAUDE_PROJECT_DIR"
B=$(git hash-object -w store/privacy-policy.html)
E=$(git hash-object -w --stdin </dev/null)
T=$(printf '100644 blob %s\t.nojekyll\n100644 blob %s\tprivacy-policy.html\n' $E $B | git mktree)
P=$(git rev-parse --verify -q gh-pages)
C=$(GIT_AUTHOR_NAME=ICUDROID GIT_AUTHOR_EMAIL=icudroid@gmail.com \
    GIT_COMMITTER_NAME=ICUDROID GIT_COMMITTER_EMAIL=icudroid@gmail.com \
    git commit-tree $T ${P:+-p $P} -m "Met à jour la politique de confidentialité")
git branch -f gh-pages $C
```

3. **Demander l'accord** avant de pousser : la page est publique.
4. **Pousser** par SSH (la session n'a pas d'identifiants HTTPS) :
   `git push git@github.com:dimkahn/ScubadivingFilter.git gh-pages:gh-pages`
5. **Vérifier** : interroger l'adresse publique toutes les 20 s pendant quelques minutes (le déploiement prend environ
   une minute), exiger HTTP 200, et comparer le contenu à `store/privacy-policy.html` (`cmp`).

Si la page reste en 404 alors que la branche est sur GitHub, demander à l'utilisateur de régler
**Settings > Pages > Deploy from a branch > gh-pages / (root)**.
