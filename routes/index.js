const router = require('express').Router();
const Schemas = require('../db');
const mongoose = require('mongoose');
const controller = require('../controllers');
const requireAuth = require('../middleware/auth');

router.post('/login', controller.login);

router.use(requireAuth);

router.post('/change-password', controller.changePassword);

router.post('/customers', controller.createCustomer);

router.patch('/customers', controller.editCustomer);

router.delete('/customers', controller.removeCustomer);

router.get('/customers', controller.getAllCustomers);

router.get('/customers/:firstName-:lastName', controller.getCustomerByName);

router.get('/customers/id/:_id', controller.getCustomerById);

router.post('/orders', controller.createOrEditOrder);

router.patch('/orders/:_id/status', controller.updateOrderStatus);

router.delete('/orders', controller.removeOrder);

router.get('/orders', controller.getAllOrders);

router.get('/orders/:orderType', controller.getOrdersByType);

router.get('/order-statuses', controller.getOrderStatuses);

router.get('/order-counts', controller.getOrderCounts);

module.exports = router;