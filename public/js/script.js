document.getElementById('saasForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.querySelector('.btn-primary');
    submitBtn.innerText = 'Redirection vers le paiement... 💳';
    submitBtn.disabled = true;

    const formData = {
        projectName: document.getElementById('projectName').value || 'mon-saas',
        options: Array.from(document.querySelectorAll('input[name="options"]:checked')).map(el => el.value)
    };

    try {
        // On demande au serveur de créer une session Stripe
        const response = await fetch('/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (data.url) {
            // On redirige l'utilisateur vers Stripe
            window.location.href = data.url;
        } else {
            alert("Erreur lors de l'initialisation du paiement.");
            submitBtn.disabled = false;
        }
    } catch (err) {
        console.error(err);
        alert("Erreur de connexion.");
        submitBtn.disabled = false;
    }
});