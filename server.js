// VERSION SECURISEE V2
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const archiver = require('archiver');
const mongoose = require('mongoose');
// Initialisation de Stripe
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

// ⚠️ IMPORTANT : Vérifie que c'est bien ton adresse Render ici 👇
const YOUR_DOMAIN = 'https://turbo-saas.onrender.com';

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// --- 1. CONNEXION BASE DE DONNÉES (MongoDB) ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB Connecté'))
    .catch(err => console.error('❌ Erreur MongoDB:', err));

// Modèle de donnée (À quoi ressemble une vente ?)
const OrderSchema = new mongoose.Schema({
    email: String,
    projectName: String,
    amount: Number,
    date: { type: Date, default: Date.now },
    stripeSessionId: String
});
const Order = mongoose.model('Order', OrderSchema);

// --- 2. ROUTES D'AFFICHAGE ---

// Page d'accueil
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/admin', async (req, res) => {
    // 🔒 SÉCURITÉ
    const adminPassword = process.env.ADMIN_PASSWORD;
    const userPassword = req.query.secret;

    if (!adminPassword || userPassword !== adminPassword) {
        return res.status(403).send("⛔ Accès INTERDIT ! Tu n'as pas le mot de passe.");
    }

    // Si le mot de passe est bon, on affiche la page...
    try {
        const orders = await Order.find().sort({ date: -1 });
        
        let html = `
            <html>
            <head>
                <title>Admin Dashboard</title>
                <style>
                    body { font-family: sans-serif; padding: 20px; background: #f4f4f4; }
                    table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
                    th, td { padding: 12px; border-bottom: 1px solid #ddd; text-align: left; }
                    th { background-color: #4F46E5; color: white; }
                    tr:hover { background-color: #f1f1f1; }
                    h1 { color: #333; }
                </style>
            </head>
            <body>
                <h1>💰 Admin Dashboard - Mes Ventes</h1>
                <p>Total ventes : <strong>${orders.length}</strong></p>
                <table>
                    <tr>
                        <th>Date</th>
                        <th>Email Client</th>
                        <th>Projet</th>
                        <th>Montant</th>
                    </tr>`;
        
        orders.forEach(order => {
            html += `
                <tr>
                    <td>${order.date.toLocaleString()}</td>
                    <td>${order.email}</td>
                    <td>${order.projectName}</td>
                    <td>${(order.amount / 100).toFixed(2)} €</td>
                </tr>`;
        });

        html += `</table><br><a href="/">← Retour au site</a></body></html>`;
        res.send(html);
    } catch (err) {
        console.error(err);
        res.send("Erreur de connexion à la base de données.");
    }
});
// Page de succès après paiement
app.get('/success', (req, res) => {
    res.send(`
        <html>
        <head>
            <title>Merci !</title>
            <link rel="stylesheet" href="/css/style.css">
        </head>
        <body style="text-align:center; padding-top:50px; background-color:#F3F4F6;">
            <div style="background:white; max-width:500px; margin:auto; padding:40px; border-radius:10px; box-shadow:0 10px 25px rgba(0,0,0,0.1);">
                <h1 style="color:#4F46E5;">Merci pour votre achat ! 🎉</h1>
                <p>Votre téléchargement va démarrer dans quelques secondes...</p>
                <p id="status" style="font-weight:bold; color:#6B7280;">Vérification du paiement...</p>
            </div>
            <script>
                const urlParams = new URLSearchParams(window.location.search);
                const sessionId = urlParams.get('session_id');

                if (sessionId) {
                    fetch('/verify-payment', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ sessionId })
                    })
                    .then(res => {
                        if (res.ok) return res.blob();
                        throw new Error('Paiement non validé');
                    })
                    .then(blob => {
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'MonSaaS.zip';
                        document.body.appendChild(a);
                        a.click();
                        document.getElementById('status').innerText = "✅ Téléchargement terminé !";
                        document.getElementById('status').style.color = "green";
                    })
                    .catch(err => {
                        document.getElementById('status').innerText = "❌ Erreur : Paiement non trouvé.";
                        document.getElementById('status').style.color = "red";
                    });
                }
            </script>
        </body>
        </html>
    `);
});

app.get('/cancel', (req, res) => res.send('<h1>Paiement annulé.</h1><a href="/">Retour</a>'));

// --- 3. API : CRÉATION SESSION STRIPE ---
app.post('/create-checkout-session', async (req, res) => {
    const { projectName, options } = req.body;

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'eur',
                    product_data: {
                        name: 'Boilerplate SaaS Node.js',
                        description: `Projet: ${projectName}`,
                    },
                    unit_amount: 900, // 9.00€
                },
                quantity: 1,
            }],
            mode: 'payment',
            metadata: { 
                projectName: projectName 
            },
            success_url: `${YOUR_DOMAIN}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${YOUR_DOMAIN}/cancel`,
        });

        res.json({ url: session.url });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- 4. API : VÉRIFICATION ET TÉLÉCHARGEMENT ---
app.post('/verify-payment', async (req, res) => {
    const { sessionId } = req.body;

    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status === 'paid') {
            // A. SAUVEGARDE EN BASE DE DONNÉES
            // On vérifie si la commande existe déjà pour ne pas l'enregistrer 2 fois
            const existingOrder = await Order.findOne({ stripeSessionId: sessionId });
            
            if (!existingOrder) {
                await Order.create({
                    email: session.customer_details.email,
                    projectName: session.metadata.projectName,
                    amount: session.amount_total,
                    stripeSessionId: sessionId
                });
                console.log(`💰 Vente enregistrée pour : ${session.customer_details.email}`);
            }

            // B. GÉNÉRATION DU ZIP
            const safeName = session.metadata.projectName.replace(/[^a-z0-9-]/gi, '_').toLowerCase();
            res.attachment(`${safeName}.zip`);

            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.pipe(res);

            // Contenu du ZIP simulé
            const packageJsonContent = {
                name: safeName,
                version: "1.0.0",
                description: "Ton SaaS généré",
                scripts: { "start": "node server.js" }
            };
            
            archive.append(JSON.stringify(packageJsonContent, null, 2), { name: 'package.json' });
            archive.append(`console.log("Merci pour tes 9€ ! Ton projet ${safeName} commence ici.");`, { name: 'server.js' });
            archive.append(`# ${safeName}\n\nMerci pour ton achat !`, { name: 'README.md' });

            archive.finalize();
        } else {
            res.status(400).send("Paiement non validé par Stripe.");
        }
    } catch (e) {
        console.error("Erreur verify-payment:", e);
        res.status(500).send("Erreur serveur interne.");
    }
});

// --- DÉMARRAGE ---
app.listen(PORT, () => {
    console.log(`🚀 Serveur lancé sur le port ${PORT}`);
});