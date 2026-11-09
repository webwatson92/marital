# Site du mariage — FAMILLES OUATTARA & KANTÉ

Faire-part numérique, programme, confirmation de présence (RSVP) et espace organisateurs sécurisé.
Hébergement **100 % gratuit** : Netlify (site) + Supabase (base de données et connexion des organisateurs).

---

## 1. Architecture

```
Invité (WhatsApp / navigateur)          Organisateur
        │                                      │
        ▼                                      ▼
  Netlify (HTTPS, gratuit)  ── pages statiques : accueil, programme, RSVP, /admin/
        │                                      │
        └──── appels sécurisés ───► Supabase (PostgreSQL + Auth, gratuit)
                                     • fonctions submit_rsvp / get_my_rsvp / get_public_info (invités)
                                     • fonctions admin_* (organisateurs connectés uniquement)
                                     • tables verrouillées (RLS) : aucun accès direct
```

| Élément | Choix | Pourquoi |
|---|---|---|
| Pages | HTML / CSS / JavaScript sans framework | Très léger (≈ 190 Ko par page, polices comprises), rapide sur réseau mobile, rien à maintenir |
| Base de données | Supabase PostgreSQL | Centralisée, persistante, offre gratuite suffisante pour 300 invités |
| Sécurité | RLS + fonctions `SECURITY DEFINER` | Toute validation se fait **côté serveur** ; un visiteur ne peut lire aucune réponse |
| Connexion admin | Supabase Auth (e-mail + mot de passe) + table `admins` | Seuls les comptes listés dans `admins` accèdent aux données |
| Programme | Stocké en base, modifiable depuis l'admin | Les « À confirmer » se mettent à jour **sans redéployer** (un déploiement coûte des crédits Netlify) |

### Pages

| Adresse | Contenu |
|---|---|
| `/` | Accueil : titre, formule d'accueil, dates, compte à rebours vers le mariage religieux puis vers la réception, boutons « Confirmer ma présence » et « Découvrir le programme », partage WhatsApp |
| `/programme.html` | Cartes des 5 événements (date, heure, lieu, adresse, itinéraire Google Maps dès qu'il est renseigné) |
| `/rsvp.html` | Formulaire de confirmation, remerciement, lien personnel de modification |
| `/dashboard/` | Espace organisateurs : tableau de bord, invités, programme, réglages |


### Informations affichées

Seules les informations confirmées figurent sur le site. Tout le reste s'affiche **« À confirmer »** :
- Mise en chambre de la mariée : lundi 21 décembre 2026, à partir de 14 h — domicile de la mariée, quartier Médico-Scolaire (près de l'Institut d'hygiène et du dispensaire urbain), Daloa.
- Danse de réjouissance : mercredi 23 décembre 2026, à partir de 14 h — même lieu.
- Mariage religieux : jeudi 24 décembre 2026 à 8 h 00 — grande cour familiale, quartier Djoulabougou (non loin de l'établissement Djoulabougou), Daloa ; Fouroussiri et attachement des colas, suivis d'une réception au domicile de la mariée.
- Prêche : Mosquée du Nouveau Quartier, Yopougon — date et heure à confirmer ; **confirmation de présence désactivée** jusqu'à ce que vous l'ouvriez depuis l'admin.
- Réception : 3 janvier 2027, Yopougon Nouveau Quartier, Abidjan — terrain à environ 15 mètres de la mosquée ; heure à confirmer.

> **Base déjà en service :** le programme de Daloa (21, 23 et 24 décembre) s'installe en exécutant une fois
> `supabase/maj-programme-daloa.sql` dans Supabase > SQL Editor. Aucune réponse d'invité n'est modifiée.

Les prénoms des mariés n'apparaissent nulle part.

---


