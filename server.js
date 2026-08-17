require('dotenv').config();

const app = require('./app');

app.set('trust proxy', 1);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`🛡️ سيرفر EgypTo الإنتاجي يعمل بأمان على منفذ ${PORT}`);
});
