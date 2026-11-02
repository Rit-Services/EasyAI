const express = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const { authHandler, requireOrg, requirePermission, requireProductionAccount } = require('../middlewares/authHandler');
const { upload } = require('../config/upload');
const ctrl = require('../controllers/compliance/documentController');

const router = express.Router();
router.use(authHandler, requireOrg);

// Checked before multer, so a test account's file never reaches the server.
router.post('/', requirePermission('compliance.edit'), requireProductionAccount, upload.single('file'), asyncHandler(ctrl.create));
router.get('/', asyncHandler(ctrl.list));
router.get('/:id/download', asyncHandler(ctrl.download));
router.delete('/:id', requirePermission('compliance.edit'), asyncHandler(ctrl.remove));

module.exports = router;
