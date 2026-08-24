# 🚀 Déploiement Rapide Google Apps Script

## 📋 Checklist de Déploiement

### 1. Ouvrir Apps Script
- Allez sur votre Google Sheet : https://docs.google.com/spreadsheets/d/1nWInNncoCsesTUxc4gLstkQCmp5zJNfID98kFBdUw20/edit
- **Extensions > Apps Script**

### 2. Coller le Code
- Supprimez le code par défaut
- Copiez-collez le contenu de `google-apps-script.js` (mis à jour avec suppression)
- **Sauvegardez** (Ctrl+S ou clic sur l'icône disquette)

### 3. Déployer
- Cliquez sur **"Déployer" > "Nouvelle déploiement"**
- **Type** : Application Web
- **Description** : "GymFlow Members API"
- **Exécuter en tant que** : Moi (votre compte)
- **Qui a accès** : Tout le monde
- Cliquez sur **"Déployer"**

> Si Google affiche "Google hasn't verified this app", cliquez sur **Advanced** puis sur **Go to Projet sans titre (unsafe)**. C'est normal pour un script privé non validé.

### 4. Copier l'URL
- Copiez l'**URL de déploiement** qui apparaît
- Elle ressemble à : `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`

### 5. Mettre à Jour .env.local
- Dans votre projet, ouvrez `.env.local`
- Remplacez `YOUR_DEPLOYMENT_ID` par votre vraie ID :
```env
NEXT_PUBLIC_GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/VOTRE_ID_REEL/exec
```

### 6. Tester
```bash
# Test complet (ajout + suppression)
node test-google-sheets.js
```

## 🔧 Dépannage

### Erreur "Sheet not found"
- Vérifiez que l'ID dans Apps Script correspond à votre Sheet
- Assurez-vous que la feuille "Members" existe

### Erreur CORS
- Vérifiez que "Qui a accès" est réglé sur "Tout le monde"

### Erreur 403
- Redéployez le script Apps Script

## ✅ Validation

Une fois déployé, testez avec le formulaire HTML :
- Ouvrez `google-sheets-form.html` dans votre navigateur
- Remplacez `YOUR_GOOGLE_SCRIPT_DEPLOYMENT_URL_HERE` par votre URL
- Ajoutez un membre de test

**La synchronisation bidirectionnelle est maintenant active !**
- ✅ Ajout → Supabase + Google Sheets
- ✅ Suppression → Supabase + Google Sheets
- ✅ Fallback automatique si une base échoue