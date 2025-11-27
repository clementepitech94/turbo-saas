require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const archiver = require('archiver');
// On initialise Stripe avec la clé secrète (stockée dans .env)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3000;
const YOUR_DOMAIN = 'https://turbo-saas.onrender.com/'; // ⚠️ Mets ton lien Render ICI !

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// --- ROUTES D'AFFICHAGE ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));

// Page de succès après paiement
app.get('/success', (req, res) => {
    res.send(`
        <html>
        <head><link rel="stylesheet" href="/css/style.css"></head>
        <body style="text-align:center; padding-top:50px;">
            <h1>Merci pour votre achat ! 🎉</h1>
            <p>Votre téléchargement va démarrer dans quelques secondes...</p>
            <p id="status">Vérification du paiement...</p>
            <script>
                // On récupère l'ID de session dans l'URL
                const urlParams = new URLSearchParams(window.location.search);
                const sessionId = urlParams.get('session_id');

                if (sessionId) {
                    fetch('/verify-payment', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ sessionId })
                    })
                    .then(res => res.blob())
                    .then(blob => {
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'MonSaaS.zip';
                        document.body.appendChild(a);
                        a.click();
                        document.getElementById('status').innerText = "Téléchargement terminé !";
                    })
                    .catch(err => document.getElementById('status').innerText = "Erreur de téléchargement.");
                }
            </script>
        </body>
        </html>
    `);
});

app.get('/cancel', (req, res) => res.send('<h1>Paiement annulé.</h1><a href="/">Retour</a>'));

// --- 1. CRÉATION DE LA SESSION DE PAIEMENT ---
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
                        description: `Projet: ${projectName} (Options: ${options.join(', ')})`,
                    },
                    unit_amount: 900, // 9.00€ (en centimes)
                },
                quantity: 1,
            }],
            mode: 'payment',
            // On stocke la config du client DANS la session Stripe pour la récupérer après
            metadata: { 
                projectName: projectName,
                options: JSON.stringify(options) 
            },
            success_url: `${YOUR_DOMAIN}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${YOUR_DOMAIN}/cancel`,
        });

        res.json({ url: session.url });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- 2. VÉRIFICATION ET TÉLÉCHARGEMENT ---
app.post('/verify-payment', async (req, res) => {
    const { sessionId } = req.body;

    try {
        // On demande à Stripe : "Ce mec a payé ?"
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status === 'paid') {
            // OUI ! On récupère ses infos
            const projectName = session.metadata.projectName;
            // On lance la génération du ZIP (même code qu'avant)
            const safeName = projectName.replace(/[^a-z0-9-]/gi, '_').toLowerCase();
            res.attachment(`${safeName}.zip`);
            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.pipe(res);
            
            // Contenu du ZIP (simplifié pour l'exemple)
            archive.append(JSON.stringify({ name: safeName }, null, 2), { name: 'package.json' });
            archive.append(`console.log("Merci pour tes 9€ !");`, { name: 'server.js' });
            archive.finalize();
        } else {
            res.status(400).send("Paiement non validé.");
        }
    } catch (e) {
        res.status(500).send("Erreur serveur.");
    }
});

app.listen(PORT, () => console.log(`Serveur lancé sur ${PORT}`));