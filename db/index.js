require('dotenv').config();
const mongoose = require('mongoose');
const { Schema } = mongoose;

// const connectionString = `mongodb+srv://${process.env.MONGOUSER}:${process.env.MONGOPSSWD}@quatro.3qnhhgk.mongodb.net/?retryWrites=true&w=majority`

// mongoose.connect(connectionString);

//module.exports = mongoose.connection.db.collection('orders');

// a calendar date with no time, e.g. "2026-12-16" (what the date picker sends)
function isCalendarDate(value) {
  if (value == null) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const ORDER_STATUSES = ['ordered', 'milled', 'bottom sandwich', 'sandwiched', 'bogged', 'hot coated', 'sanded', 'airbrushed', 'completed'];

const orderSchema = new Schema({
  intro: String,
  customerType: String,
  current: Boolean,
  orderType: String,
  approvedBy: String,
  style: String,
  lengthFt: Number,
  lengthIn: Number,
  width: Number,
  thickness: Number,
  volume: Number,
  tail: String,
  blank: String,
  construction: String,
  boardColor: String,
  finSetup: String,
  boxType: String,
  boxColor: String,
  inserts: String,
  rearStrap: String,
  strapWidth: String,
  stance: String,
  leash: String,
  pads: String,
  airbrush: String,
  boardWeight: String,
  dueDate: String, // free text typed on older orders; kept for display
  // picked from the date picker; "YYYY-MM-DD" text sorts in date order
  dueOn: { type: String, validate: { validator: isCalendarDate, message: 'Due date must be a date like 2026-12-16' } },
  finish: String,
  image: String,
  priority: String,
  waveLocation: String,
  foilType: String,
  towWeight: Number,
  logo: String,
  finFromTail: String,
  boxLocation: String,
  rearInsertsFromTail: String,
  handle: String,
  orderId: String,
  invoiceNum: String,
  customerId: String,
  customerName: String,
  notes: String,
  // no schema default on purpose: Mongoose would also apply it when reading older
  // orders that have no status. The order form picks the starting status.
  status: { type: String, enum: ORDER_STATUSES },
}, {timestamps: true});

const customerSchema = new Schema({
  firstName: String,
  lastName: String,
  phone: String,
  email: String,
  address: String,
  weight: Number,
  heightFt: Number,
  heightIn: Number,
  level: String,
})

const counterSchema = new Schema({
  seq_value: Number,
})

const authConfigSchema = new Schema({
  email: String,
  passwordHash: String,
})

const Order = mongoose.model('Order', orderSchema);
const Customer = mongoose.model('Customer', customerSchema);
const Counter = mongoose.model('Counter', counterSchema);
const AuthConfig = mongoose.model('AuthConfig', authConfigSchema);



module.exports = {
  ORDER_STATUSES,
  findCustomer: (input) => (Customer.findOne(input)),
  allCustomers: () => (Customer.find().sort({firstName: 1}).collation({locale: "en", caseLevel: true})),
  editCustomer: (filter, update) => (Customer.findOneAndUpdate(filter, update, {returnDocument: 'after'})),
  deleteCustomer: (filter) => (Customer.deleteOne(filter)),
  createCustomer: (inputObj) => (Customer.create(inputObj)),
  findOrders: (obj = {}, options = {}) => {
    // due-date sort: orders without a picked due date (older, typed ones) go last either way
    if (options.sortByDue) {
      const pipeline = [
        { $match: obj },
        { $addFields: { _noDue: { $cond: [{ $ifNull: ['$dueOn', false] }, 0, 1] } } },
        { $sort: { _noDue: 1, dueOn: options.sortByDue, createdAt: -1 } },
      ];
      if (options.skip) pipeline.push({ $skip: options.skip });
      if (options.limit) pipeline.push({ $limit: options.limit });
      pipeline.push({ $project: { _noDue: 0 } });
      return Order.aggregate(pipeline);
    }
    let query = Order.find(obj).sort(options.sort || {createdAt: -1});
    if (options.skip) query = query.skip(options.skip);
    if (options.limit) query = query.limit(options.limit);
    return query;
  },
  countOrders: (obj = {}) => (Order.countDocuments(obj)),
  createOrder: (info) => (Order.create(info)),
  editOrder: (filter, update) => (Order.findOneAndUpdate(filter, update, {returnDocument: 'after', upsert: false, runValidators: true})),
  updateOrderStatus: (filter, status) => (Order.findOneAndUpdate(filter, { $set: { status } }, { returnDocument: 'after', runValidators: true })),
  deleteOrder: (filter) => (Order.deleteOne(filter)),
  incrementSequence: () => (Counter.findOneAndUpdate({}, {$inc: {seq_value: 1}}, {returnDocument: 'after', upsert: true})),
  decrementSequence: () => (Counter.findOneAndUpdate({}, {$inc: {seq_value: -1}}, {returnDocument: 'after'})),
  getAuthConfig: () => (AuthConfig.findOne({})),
  setAuthPassword: (passwordHash) => (AuthConfig.findOneAndUpdate({}, { $set: { passwordHash } }, { returnDocument: 'after', upsert: true })),
}

//module.exports.editOrder({orderId: "13"}, {approvedBy: "pascal"}).then((res) => console.log(res));
//module.exports.allCustomers().then((res) => console.log(res).catch(err => console.log(err)));