require('dotenv').config();
require('./config/env');
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;
if(require.main===module){
  app.listen(PORT,()=>console.log(`🛡️ سيرفر EgypTo الإنتاجي يعمل بأمان على منفذ ${PORT}`));
}
module.exports=app;
