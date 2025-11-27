require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const archiver = require('archiver'); // INDISPENSABLE pour le zip

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. CONFIGURATION ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// --- 2. ROUTES D'AFFICHAGE ---

// Page d'accueil
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// --- 3. LE CERVEAU : GÉNÉRATEUR DE SAAS (Route API) ---
app.post('/generate', (req, res) => {
    const { projectName, options } = req.body;
    const safeName = projectName.replace(/[^a-z0-9-]/gi, '_').toLowerCase(); // Nettoie le nom

    console.log(`🔨 Génération en cours pour : ${safeName} avec options : ${options}`);

    // Dire au navigateur que c'est un fichier ZIP à télécharger
    res.attachment(`${safeName}.zip`);

    // Création de l'archive
    const archive = archiver('zip', { zlib: { level: 9 } });

    // En cas d'erreur
    archive.on('error', (err) => {
        res.status(500).send({ error: err.message });
    });

    // On connecte le tuyau de sortie (archive) vers la réponse internet (res)
    archive.pipe(res);

    // --- A. CRÉATION DU PACKAGE.JSON DU CLIENT ---
    const packageJsonContent = {
        name: safeName,
        version: "1.0.0",
        description: "Généré par TurboSaaS",
        main: "server.js",
        scripts: {
            "start": "node server.js",
            "dev": "nodemon server.js"
        },
        dependencies: {
            "express": "^4.18.2",
            "mongoose": "^7.0.0",
            "dotenv": "^16.0.0"
        }
    };
    // On ajoute le fichier dans le ZIP
    archive.append(JSON.stringify(packageJsonContent, null, 2), { name: 'package.json' });

    // --- B. CRÉATION DU SERVER.JS DU CLIENT ---
    const serverJsContent = `
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Route de base
app.get('/', (req, res) => {
    res.send('<h1>Bienvenue sur ${safeName} ! 🚀</h1><p>Ton SaaS est prêt à être codé.</p>');
});

app.listen(PORT, () => {
    console.log(\`Serveur lancé sur http://localhost:\${PORT}\`);
});
    `;
    archive.append(serverJsContent, { name: 'server.js' });

    // --- C. CRÉATION DU README ---
    const readMeContent = `
# ${safeName}
Généré par TurboSaaS.

## Comment lancer ton projet ?
1. Ouvre ce dossier dans ton terminal.
2. Tape "npm install" pour installer les dépendances.
3. Tape "npm start" pour lancer le serveur.
    `;
    archive.append(readMeContent, { name: 'README.md' });

    // --- FINALISATION ---
    archive.finalize();
});

// --- 4. DÉMARRAGE DU SERVEUR TURBOSAAS ---
app.listen(PORT, () => {
    console.log(`🚀 TurboSaaS tourne sur http://localhost:${PORT}`);
});