require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');

const dbName = process.env.MONGODB_NAME || 'quatro';
const connectionString = `mongodb+srv://${process.env.MONGOUSER}:${process.env.MONGOPSSWD}@quatro.sgb5fdh.mongodb.net/${dbName}?retryWrites=true&w=majority`

const db = mongoose.connect(connectionString);

//test
const port = process.env.PORT || 3000;

app.set('port', port);
app.listen(port, () => console.log(`listening on port ${port}`));


module.exports = db;
