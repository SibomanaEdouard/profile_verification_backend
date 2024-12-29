const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const NotificationController = require('../controllers/NotificationController');

// Get user notifications
router.get('/notifications', auth, NotificationController.getUserNotifications);

// Mark notification as read
router.put('/notifications/:notificationId/read', auth, NotificationController.markAsRead);

// Mark all notifications as read
router.put('/notifications/mark-all-read', auth, NotificationController.markAllAsRead);

// Delete notification
router.delete('/notifications/:notificationId', auth, NotificationController.deleteNotification);

// Clear all notifications
router.delete('/notifications', auth, NotificationController.clearAllNotifications);

// Get unread count
router.get('/notifications/unread-count', auth, NotificationController.getUnreadCount);

module.exports = router;