process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

const { describe, test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');

const STATUSES = ['ordered', 'milled', 'bottom sandwich', 'sandwiched', 'bogged', 'hot coated', 'sanded', 'airbrushed', 'completed'];

let mongo;
const auth = `Bearer ${jwt.sign({ email: 'test@test.com' }, 'test-secret')}`;

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterEach(async () => {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

// status 'ordered' mirrors the order form's default
const createOrder = (body = {}) => request(app)
  .post('/orders')
  .set('Authorization', auth)
  .send({ orderType: 'surf', customerType: 'retail', customerName: 'jane doe', status: 'ordered', ...body });

const setStatus = (_id, status) => request(app)
  .patch(`/orders/${_id}/status`)
  .set('Authorization', auth)
  .send({ status });

const listOrders = (query) => request(app)
  .get('/orders')
  .query(query)
  .set('Authorization', auth);

describe('creating an order', () => {
  test('saves the status chosen in the form', async () => {
    const res = await createOrder({ status: 'milled' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'milled');
  });

  test('has no status when none is sent', async () => {
    const res = await createOrder({ status: undefined });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, undefined);
  });

  test('treats an empty or null status as none', async () => {
    const empty = await createOrder({ status: '' });
    const nul = await createOrder({ status: null });
    assert.equal(empty.status, 200);
    assert.equal(empty.body.status, undefined);
    assert.equal(nul.status, 200);
    assert.equal(nul.body.status, undefined);
  });

  test('rejects an invalid status without using up an order number', async () => {
    const bad = await createOrder({ status: 'bogus' });
    assert.equal(bad.status, 400);

    const first = await createOrder();
    assert.match(first.body.orderId, /-1$/);
  });
});

describe('GET /order-statuses', () => {
  test('returns every status in workflow order', async () => {
    const res = await request(app).get('/order-statuses').set('Authorization', auth);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, STATUSES);
  });
});

describe('PATCH /orders/:_id/status', () => {
  test('updates and persists the status', async () => {
    const { body: order } = await createOrder();

    const res = await setStatus(order._id, 'milled');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'milled');

    const { body: orders } = await listOrders({ status: 'milled' });
    assert.deepEqual(orders.map((o) => o._id), [order._id]);
  });

  test('allows moving to any status, including backwards', async () => {
    const { body: order } = await createOrder();
    await setStatus(order._id, 'completed');

    const res = await setStatus(order._id, 'milled');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'milled');
  });

  test('rejects an unknown status and leaves the order unchanged', async () => {
    const { body: order } = await createOrder();

    const res = await setStatus(order._id, 'bogus');
    assert.equal(res.status, 400);

    const { body: orders } = await listOrders({ status: 'ordered' });
    assert.equal(orders.length, 1);
  });

  test('returns 404 for an order that does not exist', async () => {
    const res = await setStatus(new mongoose.Types.ObjectId().toString(), 'milled');
    assert.equal(res.status, 404);
  });

  test('returns 400 for a malformed id', async () => {
    const res = await setStatus('not-an-id', 'milled');
    assert.equal(res.status, 400);
  });

  test('requires auth', async () => {
    const { body: order } = await createOrder();
    const res = await request(app).patch(`/orders/${order._id}/status`).send({ status: 'milled' });
    assert.equal(res.status, 401);
  });
});

describe('editing a full order', () => {
  const editOrder = (order, changes) => request(app)
    .post('/orders')
    .set('Authorization', auth)
    .send({ ...order, ...changes });

  test('keeps the status when none is sent', async () => {
    const { body: order } = await createOrder();
    await setStatus(order._id, 'bogged');
    const { status, ...withoutStatus } = order;

    const res = await editOrder(withoutStatus, { notes: 'new notes' });
    assert.equal(res.status, 200);
    assert.equal(res.body.notes, 'new notes');
    assert.equal(res.body.status, 'bogged');
  });

  test('updates the status when a valid one is sent', async () => {
    const { body: order } = await createOrder();

    const res = await editOrder(order, { status: 'sanded' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'sanded');
  });

  test('rejects an invalid status', async () => {
    const { body: order } = await createOrder();

    const res = await editOrder(order, { status: 'bogus' });
    assert.equal(res.status, 400);
  });

  test('a null status from the form does not clear the existing one', async () => {
    const { body: order } = await createOrder({ status: 'bogged' });

    const res = await editOrder(order, { status: null });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'bogged');
  });
});

describe('orders created before statuses existed', () => {
  // written straight to the collection, like the orders already in production
  const insertLegacyOrder = async (fields = {}) => {
    const { insertedId } = await mongoose.connection.db.collection('orders')
      .insertOne({ orderType: 'surf', orderId: '25-1', createdAt: new Date(), ...fields });
    return insertedId.toString();
  };

  test('come back with no status instead of a default', async () => {
    await insertLegacyOrder();
    const res = await listOrders({});
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].status, undefined);
  });

  test('stay without a status when edited', async () => {
    const _id = await insertLegacyOrder();
    const res = await request(app)
      .post('/orders')
      .set('Authorization', auth)
      .send({ _id, orderId: '25-1', notes: 'edited' });
    assert.equal(res.status, 200);
    assert.equal(res.body.notes, 'edited');
    assert.equal(res.body.status, undefined);

    const stored = await mongoose.connection.db.collection('orders').findOne({ _id: new mongoose.Types.ObjectId(_id) });
    assert.equal(stored.status, undefined);
  });

  test('can be given a status', async () => {
    const _id = await insertLegacyOrder();
    const res = await setStatus(_id, 'sanded');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'sanded');
  });

  test('are found with status=none and excluded from other statuses', async () => {
    await insertLegacyOrder();
    await createOrder();

    const none = await listOrders({ status: 'none' });
    assert.equal(none.body.length, 1);
    assert.equal(none.body[0].status, undefined);
    assert.equal(none.headers['x-total-count'], '1');

    const ordered = await listOrders({ status: 'ordered' });
    assert.equal(ordered.body.length, 1);
    assert.equal(ordered.body[0].status, 'ordered');
  });
});

describe('filtering GET /orders by status', () => {
  beforeEach(async () => {
    const seed = [
      { orderType: 'surf', status: 'milled' },
      { orderType: 'surf', status: 'milled' },
      { orderType: 'foil', status: 'milled' },
      { orderType: 'surf', status: 'completed' },
      { orderType: 'tow', status: 'ordered' },
    ];
    for (const { orderType, status } of seed) {
      const { body: order } = await createOrder({ orderType });
      await setStatus(order._id, status);
    }
  });

  test('returns only orders with that status', async () => {
    const res = await listOrders({ status: 'milled' });
    assert.equal(res.body.length, 3);
    assert.ok(res.body.every((o) => o.status === 'milled'));
    assert.equal(res.headers['x-total-count'], '3');
  });

  test('combines with the type filter', async () => {
    const res = await listOrders({ type: 'surf', status: 'milled' });
    assert.equal(res.body.length, 2);
    assert.ok(res.body.every((o) => o.orderType === 'surf' && o.status === 'milled'));
    assert.equal(res.headers['x-total-count'], '2');
  });

  test('"all" or no status returns every order', async () => {
    const all = await listOrders({ status: 'all' });
    const none = await listOrders({});
    assert.equal(all.body.length, 5);
    assert.equal(none.body.length, 5);
    assert.equal(all.headers['x-total-count'], '5');
  });
});
