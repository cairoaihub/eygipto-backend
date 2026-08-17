require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const helmet = require('helmet');
const morgan = require('morgan');
const crypto = require('crypto');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const app = express();

app.set('trust proxy', 1);

const PORT = process.env.PORT || 5000;
if(require.main===module){
  app.listen(PORT,()=>console.log(`🛡️ سيرفر EgypTo الإنتاجي يعمل بأمان على منفذ ${PORT}`));
}
module.exports=app;
