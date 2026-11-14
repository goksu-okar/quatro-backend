process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

const { describe, test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');

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

const post = (body) => request(app).post('/orders').set('Authorization', auth).send(body);
const listOrders = (query) => request(app).get('/orders').query(query).set('Authorization', auth);
const orders = () => mongoose.connection.db.collection('orders');

describe('due date', () => {
  test('is saved as just a date (no time) from the date picker', async () => {
    const res = await post({ orderType: 'surf', status: 'ordered', dueOn: '2026-12-16' });
    assert.equal(res.status, 200);
    assert.equal(res.body.dueOn, '2026-12-16');

    const stored = await orders().findOne({});
    assert.equal(stored.dueOn, '2026-12-16');
  });

  for (const bad of ['mid jan', '12/16/2026', '2026-12-16T10:00:00Z', '2026-02-30', '2026-13-01']) {
    test(`rejects "${bad}"`, async () => {
      const res = await post({ orderType: 'surf', dueOn: bad });
      assert.equal(res.status, 400);
    });
  }

  test('rejects an invalid date when editing too', async () => {
    const { body: order } = await post({ orderType: 'surf', dueOn: '2026-12-16' });
    const res = await post({ ...order, dueOn: '2026-02-30' });
    assert.equal(res.status, 400);
  });

  test('editing an old order keeps its typed due date text', async () => {
    const { insertedId } = await orders().insertOne({ orderId: '25-9', dueDate: 'mid jan', createdAt: new Date() });

    const res = await post({ _id: insertedId.toString(), orderId: '25-9', dueOn: '2027-01-15' });
    assert.equal(res.status, 200);
    assert.equal(res.body.dueOn, '2027-01-15');
    assert.equal(res.body.dueDate, 'mid jan');
  });
});

describe('sorting by due date', () => {
  const seed = async () => {
    await orders().insertMany([
      { orderId: '26-1', orderType: 'surf', dueOn: '2026-12-20', createdAt: new Date(2026, 0, 1) },
      { orderId: '26-2', orderType: 'foil', dueOn: '2026-12-01', createdAt: new Date(2026, 0, 2) },
      { orderId: '25-8', orderType: 'surf', dueDate: 'mid jan', createdAt: new Date(2025, 0, 1) },
      { orderId: '26-3', orderType: 'surf', dueOn: '2026-12-10', createdAt: new Date(2026, 0, 3) },
      { orderId: '25-9', orderType: 'tow', createdAt: new Date(2025, 0, 2) },
    ]);
  };
  const orderIds = (res) => res.body.map((o) => o.orderId);

  test('soonest first, with orders that have no real due date at the end', async () => {
    await seed();
    const res = await listOrders({ sort: 'dueOn', dir: 'asc' });
    assert.equal(res.status, 200);
    assert.deepEqual(orderIds(res), ['26-2', '26-3', '26-1', '25-9', '25-8']);
  });

  test('latest first still keeps orders without a real due date at the end', async () => {
    await seed();
    const res = await listOrders({ sort: 'dueOn', dir: 'desc' });
    assert.deepEqual(orderIds(res), ['26-1', '26-3', '26-2', '25-9', '25-8']);
  });

  test('works with filters and pagination', async () => {
    await seed();
    const res = await listOrders({ sort: 'dueOn', dir: 'asc', orderType: 'surf', page: 1, limit: 2 });
    assert.deepEqual(orderIds(res), ['26-3', '26-1']);
    assert.equal(res.headers['x-total-count'], '3');

    const page2 = await listOrders({ sort: 'dueOn', dir: 'asc', orderType: 'surf', page: 2, limit: 2 });
    assert.deepEqual(orderIds(page2), ['25-8']);
  });

  test('an unknown sort field falls back to newest first', async () => {
    await seed();
    const res = await listOrders({ sort: 'bogus' });
    assert.deepEqual(orderIds(res), ['26-3', '26-2', '26-1', '25-9', '25-8']);
  });
});

describe('due type (ASAP / whenever) is not supported', () => {
  test('a dueType sent by an old client is not saved', async () => {
    const res = await post({ orderType: 'surf', dueType: 'asap', dueOn: '2026-12-16' });
    assert.equal(res.status, 200);
    assert.equal(res.body.dueType, undefined);
    assert.equal(res.body.dueOn, '2026-12-16');
    assert.equal((await orders().findOne({})).dueType, undefined);
  });
});
