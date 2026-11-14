const db = require('../db');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// validation/cast errors are the client's fault; anything else is ours
function sendError(res, err) {
  const status = (err.name === 'ValidationError' || err.name === 'CastError') ? 400 : 500;
  res.status(status).send({ error: err.message });
}

// "a,b" or ?x=a&x=b -> ['a', 'b']
function paramList(value) {
  if (!value) return [];
  return String(value).split(',').map((v) => v.trim()).filter(Boolean);
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// quick views: "active" = everything but the last status, "completed" = the last one
const STATUS_VIEWS = {
  active: () => db.ORDER_STATUSES.slice(0, -1),
  completed: () => db.ORDER_STATUSES.slice(-1),
};

// status param: comma list of statuses, views, or "none" (orders from before statuses existed)
function statusCondition(status) {
  const tokens = paramList(status);
  if (!tokens.length || tokens.includes('all')) return null;

  const values = [];
  for (const token of tokens) {
    if (token === 'none') values.push(null); // null also matches a missing field
    else if (STATUS_VIEWS[token]) values.push(...STATUS_VIEWS[token]());
    else if (db.ORDER_STATUSES.includes(token)) values.push(token);
    else {
      const err = new Error(`Unknown status: ${token}`);
      err.name = 'ValidationError';
      throw err;
    }
  }
  return { status: { $in: values } };
}

// filters shared by the order list and the quick-view counts
function orderFilter(query, { withStatus = true } = {}) {
  const { type, orderType, customerType, status, q } = query;
  const conditions = [];

  if (type && type !== 'all') conditions.push({ $or: [{ orderType: type }, { customerType: type }] });
  if (paramList(orderType).length) conditions.push({ orderType: { $in: paramList(orderType) } });
  if (paramList(customerType).length) conditions.push({ customerType: { $in: paramList(customerType) } });
  if (q && String(q).trim()) {
    const pattern = new RegExp(escapeRegex(String(q).trim()), 'i');
    conditions.push({ $or: [{ customerName: pattern }, { orderId: pattern }] });
  }
  if (withStatus) {
    const condition = statusCondition(status);
    if (condition) conditions.push(condition);
  }

  return conditions.length > 1 ? { $and: conditions } : (conditions[0] || {});
}

function getLastTwoDigitsOfYear() {
  let date = new Date();
  return date.getFullYear() % 2000;
}

module.exports = {
  login: (req, res) => {
    const { email, password } = req.body;

    db.getAuthConfig()
      .then((config) => {
        if (!config) {
          return res.status(500).send({ error: 'Login is not set up yet' });
        }
        const validEmail = (email || '').trim().toLowerCase() === (config.email || '').trim().toLowerCase();
        if (!validEmail) {
          return res.status(401).send({ error: 'Invalid email or password' });
        }
        return bcrypt.compare(password || '', config.passwordHash || '')
          .then((validPassword) => {
            if (!validPassword) {
              return res.status(401).send({ error: 'Invalid email or password' });
            }
            const token = jwt.sign({ email: config.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
            res.send({ token });
          });
      })
      .catch((err) => res.status(500).send({ error: err.message }));
  },
  changePassword: (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).send({ error: 'New password must be at least 8 characters' });
    }

    db.getAuthConfig()
      .then((config) => {
        if (!config) {
          return res.status(500).send({ error: 'Login is not set up yet' });
        }
        return bcrypt.compare(currentPassword || '', config.passwordHash || '')
          .then((validPassword) => {
            if (!validPassword) {
              return res.status(401).send({ error: 'Current password is incorrect' });
            }
            return bcrypt.hash(newPassword, 10)
              .then((hash) => db.setAuthPassword(hash))
              .then(() => res.send({ success: true }));
          });
      })
      .catch((err) => res.status(500).send({ error: err.message }));
  },
  getAllCustomers: (req, res) => {
    db.allCustomers().then((result) => {res.send(result)})
    .catch((err) => res.send(err));
  },
  editCustomer: (req, res) => {
    const _id = req.body._id.valueOf();
    console.log(req.body)
    delete req.body._id;
    db.editCustomer({ _id }, req.body)
      .then((result) => {
        res.send(result)
      })
      .catch(err => console.log(err));
  },
  removeCustomer: (req, res) => {
    const _id = req.body._id.valueOf();
    db.deleteCustomer({ _id })
      .then((result) => {res.end()})
      .catch((err) => {res.send(err)})
  },
  getCustomerByName: (req, res) => {
    const nameObj = req.params;
    let { firstName, lastName } = nameObj;
    firstName = firstName.toLowerCase();
    lastName = lastName.toLowerCase();
    db.findCustomer({firstName, lastName})
      .then((result) => {
        if (result) {
          res.send(result);
        } else {
          res.send(false);
        }
      })
  },
  getCustomerById: (req, res) => {
    db.findCustomer(req.params)
      .then((result) => {
        res.send(result)
      })
      .catch((err) => res.send(err))
  },
  createCustomer: (req, res) =>
  {
    db.createCustomer(req.body)
      .then((result) => {
        res.send(result)
      })
      .catch((err) => res.send(err))
  },
  getOrderByCustomerId: (req, res) => {
    let { customerId } = req.params;
    db.findOrders({ customerId })
      .then((result) => res.send(result))
      .catch(err => res.send(err))
  },
  // if order is for editing, finds and edits the order matching object id
  // if order is new, creates the order. Uses two different functions from the db
  createOrEditOrder: (req, res) => {
    // the form sends null/'' when no status is picked: leave it unset on create, unchanged on edit
    if (req.body.status === null || req.body.status === '') {
      delete req.body.status;
    }
    if (req.body.orderId) {
      const _id = req.body._id.valueOf();
      delete req.body._id;
      db.editOrder({ _id }, req.body)
        .then((result) => {
          res.send(result)
        })
        .catch(err => {
          console.log(err);
          sendError(res, err);
        });
    } else {
      db.incrementSequence()
        .then((result) => {
          const year = getLastTwoDigitsOfYear();
          const orderId = `${year}-${result.seq_value}`;
          // const orderId = result.seq_value;
          db.createOrder({...req.body, orderId})
            .then((newResult) => {
              res.send(newResult)
            })
            .catch((err) => {
              console.log(err);
              // give the order number back before replying, so the next order can't skip it
              db.decrementSequence()
                .finally(() => sendError(res, err));
            })
        })
        .catch((err) => {
          console.log(err);
          res.status(500).send({ error: err.message });
        })
    }
  },
  getOrdersByType: (req, res) => {
    const { orderType } = req.params;
    db.findOrders({orderType})
      .then((result) => res.send(result))
      .catch(err => res.send(err))
  },
  getCustomerOrders: (req, res) => {
    const {firstName, lastName, page} = req.params;
    db.findCustomer({firstName, lastName})
      .then((result) => {
        if (result) {
          let customerId = result._id.valueOf();
          db.findOrders({ customerId }, page)
            .then(result => res.send(result))
        } else {
          res.send("customer not found")
        }
      })
  },
  getAllOrders: (req, res) => {
    const { page, limit, sort, dir, all } = req.query;

    if (all) {
      db.findOrders()
        .then((result) => res.send(result))
        .catch(err => res.send(err));
      return;
    }

    const pageNum = parseInt(page, 10) || 1;
    const pageSize = parseInt(limit, 10) || 100;
    let filter;
    try {
      filter = orderFilter(req.query);
    } catch (err) {
      return sendError(res, err);
    }
    const direction = dir === 'asc' ? 1 : -1;
    const sortOptions = sort === 'dueOn'
      ? { sortByDue: direction }
      : { sort: { createdAt: direction } };

    Promise.all([
      db.findOrders(filter, { skip: (pageNum - 1) * pageSize, limit: pageSize, ...sortOptions }),
      db.countOrders(filter),
    ])
      .then(([orders, total]) => {
        res.set('X-Total-Count', total);
        res.send(orders);
      })
      .catch(err => res.send(err));
  },
  updateOrderStatus: (req, res) => {
    const { _id } = req.params;
    const { status } = req.body;

    if (!mongoose.isValidObjectId(_id)) {
      return res.status(400).send({ error: 'Invalid order id' });
    }
    if (!db.ORDER_STATUSES.includes(status)) {
      return res.status(400).send({ error: `Status must be one of: ${db.ORDER_STATUSES.join(', ')}` });
    }

    db.updateOrderStatus({ _id }, status)
      .then((result) => {
        if (!result) {
          return res.status(404).send({ error: 'Order not found' });
        }
        res.send(result);
      })
      .catch((err) => sendError(res, err));
  },
  getOrderStatuses: (req, res) => {
    res.send(db.ORDER_STATUSES);
  },
  // counts for the Active / Completed / All quick views, under the same non-status filters
  getOrderCounts: (req, res) => {
    const base = orderFilter(req.query, { withStatus: false });
    const inView = (view) => ({ $and: [base, statusCondition(view)] });

    Promise.all([
      db.countOrders(inView('active')),
      db.countOrders(inView('completed')),
      db.countOrders(base),
    ])
      .then(([active, completed, all]) => res.send({ active, completed, all }))
      .catch((err) => sendError(res, err));
  },
  removeOrder: (req, res) => {
    const _id = req.body._id.valueOf();
    db.deleteOrder({ _id })
      .then((result) => {res.end()})
      .catch((err) => {res.send(err)})
  }
};