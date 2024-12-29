const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const NotificationController = require('../controllers/NotificationController');

// Get user notifications
router.get('', auth, NotificationController.getUserNotifications);

// Mark notification as read
router.put('/:notificationId/read', auth, NotificationController.markAsRead);

// Mark all notifications as read
router.put('/mark-all-read', auth, NotificationController.markAllAsRead);

// Delete notification
router.delete('/:notificationId', auth, NotificationController.deleteNotification);

// Clear all notifications
router.delete('', auth, NotificationController.clearAllNotifications);

// Get unread count
router.get('/unread-count', auth, NotificationController.getUnreadCount);

module.exports = router;