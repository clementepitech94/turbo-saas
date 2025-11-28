require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const archiver = require('archiver');
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3000;
const YOUR_DOMAIN = 'https://turbo-saas.onrender.com'; // ⚠️ Ton lien Render

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

mongoose.connect(process.env.MONGO_URI).then(()=>console.log('DB OK')).catch(e=>console.log(e));
const Order = mongoose.model('Order', new mongoose.Schema({ email:String, projectName:String, amount:Number, offer:String, date:{type:Date, default:Date.now}, stripeSessionId:String }));

// LE PROMPT CONTEXTUEL (Adapté au code)
const PROMPT_TEXT = `=== PROMPT COPILOTE SAAS ===
Copie ceci dans ton IA :
"Je code sur le Boilerplate TurboSaaS (Node/Express/Mongo/MVC).
Architecture :
- /models (Schemas Mongoose)
- /routes (Logique Backend)
- /views (Frontend HTML)
- server.js (Config)
Agis comme un expert de cette stack. Quand je demande une feature, donne-moi le code pour ces 4 dossiers."`;

// --- ROUTES ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));

app.get('/admin', async (req, res) => {
    if(req.query.secret !== process.env.ADMIN_PASSWORD) return res.status(403).send("⛔");
    const orders = await Order.find().sort({ date: -1 });
    const total = orders.reduce((acc, o) => acc + o.amount, 0) / 100;
    res.send(`<h1>Total: ${total.toFixed(2)}€</h1><pre>${JSON.stringify(orders, null, 2)}</pre>`);
});

app.get('/success', (req, res) => {
    res.send(`<html><body style="background:#08090A;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;text-align:center"><div><h1>✅ Merci !</h1><p id="status">Préparation de votre commande...</p></div><script>const p=new URLSearchParams(window.location.search);const s=p.get('session_id');if(s){fetch('/verify-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s})}).then(r=>r.blob()).then(b=>{const u=window.URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download='TurboSaaS_Pack.zip';document.body.appendChild(a);a.click();document.getElementById('status').innerText="Téléchargement lancé !";})}</script></body></html>`);
});
app.get('/cancel', (req, res) => res.redirect('/'));

// --- PAIEMENT ---
app.post('/create-checkout-session', async (req, res) => {
    const { projectName, offerType } = req.body;
    
    let price = 1499;
    let name = 'Pack Starter (Code)';
    
    if (offerType === 'prompt') {
        price = 2499;
        name = 'Pack Mentor IA (Prompt)';
    } else if (offerType === 'ultimate') {
        price = 3299;
        name = 'Pack ULTIMATE (Code + Prompt)';
    }

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: { currency: 'eur', product_data: { name }, unit_amount: price },
                quantity: 1,
            }],
            mode: 'payment',
            metadata: { projectName, offerType },
            success_url: `${YOUR_DOMAIN}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${YOUR_DOMAIN}/cancel`,
        });
        res.json({ url: session.url });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- LIVRAISON ---
app.post('/verify-payment', async (req, res) => {
    const { sessionId } = req.body;
    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === 'paid') {
            const { projectName, offerType } = session.metadata;
            const safeName = projectName.replace(/[^a-z0-9-]/gi, '_').toLowerCase();

            // BDD
            const existing = await Order.findOne({ stripeSessionId: sessionId });
            if (!existing) await Order.create({ email: session.customer_details.email, projectName: safeName, amount: session.amount_total, offer: offerType, stripeSessionId: sessionId });

            // ZIP
            res.attachment(`${safeName}_${offerType}.zip`);
            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.pipe(res);

            // LOGIQUE DE CONTENU DU ZIP
            const includeCode = (offerType === 'starter' || offerType === 'ultimate');
            const includePrompt = (offerType === 'prompt' || offerType === 'ultimate');

            if (includeCode) {
                // Ajout du Code SaaS (MVC)
                archive.append(JSON.stringify({ name: safeName, dependencies: {"express": "^4.18.2"} }, null, 2), { name: 'package.json' });
                archive.append(`require('dotenv').config();\nconst express=require('express');\nconst app=express();\napp.listen(3000);`, { name: 'server.js' });
                archive.append('// Vos routes ici', { name: 'routes/index.js' });
                archive.append('// Vos modèles ici', { name: 'models/User.js' });
            }

            if (includePrompt) {
                // Ajout du Prompt
                archive.append(PROMPT_TEXT, { name: 'GUIDE_IA_COPILOTE.txt' });
            }

            // README adaptatif
            let readme = `# Merci pour votre achat !\n\n`;
            if (includeCode) readme += `## Installation\n1. npm install\n2. npm start\n\n`;
            if (includePrompt) readme += `## Utilisation IA\nOuvrez le fichier GUIDE_IA_COPILOTE.txt et copiez le texte dans ChatGPT.`;
            archive.append(readme, { name: 'README.md' });

            archive.finalize();
        } else { res.status(400).send("Erreur"); }
    } catch (e) { res.status(500).send("Erreur"); }
});

app.listen(PORT, () => console.log(`Serveur ${PORT}`));