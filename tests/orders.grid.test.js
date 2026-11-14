process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

const { describe, test, before, after, beforeEach, afterEach } = require('node:test');
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

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const listOrders = (query) => request(app).get('/orders').query(query).set('Authorization', auth);
const getCounts = (query) => request(app).get('/order-counts').query(query).set('Authorization', auth);
const ids = (res) => res.body.map((o) => o.orderId).sort();

// written straight to the collection so createdAt (and a missing status) are exact
const SEED = [
  { orderId: '26-1', customerName: 'jane doe', orderType: 'surf', customerType: 'retail', status: 'milled' },
  { orderId: '26-2', customerName: 'kai akana', orderType: 'foil', customerType: 'team', status: 'sanded' },
  { orderId: '26-3', customerName: 'Jane Smith', orderType: 'surf', customerType: 'wholesale', status: 'completed' },
  { orderId: '26-4', customerName: 'leilani park', orderType: 'tow', customerType: 'retail', status: 'ordered' },
  { orderId: '25-9', customerName: 'old (customer)', orderType: 'surf', customerType: 'retail' },
];

beforeEach(async () => {
  await mongoose.connection.db.collection('orders').insertMany(
    SEED.map((o, i) => ({ ...o, createdAt: new Date(2026, 0, i + 1) })),
  );
});

afterEach(async () => {
  await mongoose.connection.db.collection('orders').deleteMany({});
});

describe('status filter', () => {
  test('"active" is every status except completed, and leaves out orders with no status', async () => {
    const res = await listOrders({ status: 'active' });
    assert.deepEqual(ids(res), ['26-1', '26-2', '26-4']);
    assert.equal(res.headers['x-total-count'], '3');
  });

  test('"completed" returns only completed orders', async () => {
    assert.deepEqual(ids(await listOrders({ status: 'completed' })), ['26-3']);
  });

  test('accepts several statuses at once', async () => {
    assert.deepEqual(ids(await listOrders({ status: 'milled,sanded' })), ['26-1', '26-2']);
  });

  test('"none" can be combined with real statuses', async () => {
    assert.deepEqual(ids(await listOrders({ status: 'none,ordered' })), ['25-9', '26-4']);
  });

  test('rejects an unknown status', async () => {
    const res = await listOrders({ status: 'milled,bogus' });
    assert.equal(res.status, 400);
  });
});

describe('type filters', () => {
  test('filters by several board types', async () => {
    assert.deepEqual(ids(await listOrders({ orderType: 'foil,tow' })), ['26-2', '26-4']);
  });

  test('filters by customer type', async () => {
    assert.deepEqual(ids(await listOrders({ customerType: 'team,wholesale' })), ['26-2', '26-3']);
  });

  test('combines with the status filter', async () => {
    const res = await listOrders({ orderType: 'surf', status: 'active' });
    assert.deepEqual(ids(res), ['26-1']);
    assert.equal(res.headers['x-total-count'], '1');
  });

  test('the old single "type" param still works', async () => {
    assert.deepEqual(ids(await listOrders({ type: 'team' })), ['26-2']);
  });
});

describe('search', () => {
  test('matches part of the customer name, ignoring case', async () => {
    assert.deepEqual(ids(await listOrders({ q: 'JANE' })), ['26-1', '26-3']);
  });

  test('matches the order number', async () => {
    assert.deepEqual(ids(await listOrders({ q: '26-2' })), ['26-2']);
  });

  test('treats special characters as plain text', async () => {
    const res = await listOrders({ q: '(customer' });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res), ['25-9']);
  });
});

describe('sorting', () => {
  test('newest first by default', async () => {
    const res = await listOrders({});
    assert.deepEqual(res.body.map((o) => o.orderId), ['25-9', '26-4', '26-3', '26-2', '26-1']);
  });

  test('oldest first with dir=asc', async () => {
    const res = await listOrders({ dir: 'asc' });
    assert.deepEqual(res.body.map((o) => o.orderId), ['26-1', '26-2', '26-3', '26-4', '25-9']);
  });
});

describe('GET /order-counts', () => {
  test('counts each quick view', async () => {
    const res = await getCounts({});
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { active: 3, completed: 1, all: 5 });
  });

  test('respects the other filters but not the status filter', async () => {
    const res = await getCounts({ orderType: 'surf', q: 'jane', status: 'milled' });
    assert.deepEqual(res.body, { active: 1, completed: 1, all: 2 });
  });

  test('requires auth', async () => {
    const res = await request(app).get('/order-counts');
    assert.equal(res.status, 401);
  });
});
