const express = require('express');
const morgan = require('morgan');
const routes = require('./routes');
const cors = require('cors');

const app = express();

if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
app.use(express.json());
app.use(cors({ exposedHeaders: ['X-Total-Count'] }));

app.use('/', routes);

module.exports = app;
