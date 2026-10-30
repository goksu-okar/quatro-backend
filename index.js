require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const mongoose = require('mongoose');
const routes = require('./routes');
const cors = require('cors');

const app = express();

const dbName = process.env.MONGODB_NAME || 'quatro';
const connectionString = `mongodb+srv://${process.env.MONGOUSER}:${process.env.MONGOPSSWD}@quatro.sgb5fdh.mongodb.net/${dbName}?retryWrites=true&w=majority`

const db = mongoose.connect(connectionString);

//test
const port = process.env.PORT || 3000;

app.use(morgan('dev'));
app.use(express.json());
app.use(cors({ exposedHeaders: ['X-Total-Count'] }));

app.use('/', routes);

app.set('port', port);
app.listen(port, () => console.log(`listening on port ${port}`));


module.exports = db;
