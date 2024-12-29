const Notification = require('../models/Notification');

class NotificationController {
  // Get user notifications
  static async getUserNotifications(req, res) {
    try {
      const { page = 1, limit = 10, status } = req.query;
      const query = { userId: req.user.id };
      
      if (status) {
        query.status = status;
      }

      const notifications = await Notification.find(query)
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .exec();

      const count = await Notification.countDocuments(query);

      res.json({
        notifications,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        totalCount: count
      });
    } catch (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).json({ error: 'Error fetching notifications' });
    }
  }

  // Mark notification as read
  static async markAsRead(req, res) {
    try {
      const { notificationId } = req.params;
      
      const notification = await Notification.findOne({
        _id: notificationId,
        userId: req.user.id
      });

      if (!notification) {
        return res.status(404).json({ error: 'Notification not found' });
      }

      await notification.markAsRead();
      res.json({ success: true, notification });
    } catch (error) {
      console.error('Error marking notification as read:', error);
      res.status(500).json({ error: 'Error marking notification as read' });
    }
  }

  // Mark all notifications as read
  static async markAllAsRead(req, res) {
    try {
      await Notification.updateMany(
        { userId: req.user.id, status: 'unread' },
        { 
          $set: { 
            status: 'read',
            readAt: new Date()
          }
        }
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      res.status(500).json({ error: 'Error marking all notifications as read' });
    }
  }

  // Delete notification
  static async deleteNotification(req, res) {
    try {
      const { notificationId } = req.params;
      
      const notification = await Notification.findOneAndDelete({
        _id: notificationId,
        userId: req.user.id
      });

      if (!notification) {
        return res.status(404).json({ error: 'Notification not found' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting notification:', error);
      res.status(500).json({ error: 'Error deleting notification' });
    }
  }

  // Clear all notifications
  static async clearAllNotifications(req, res) {
    try {
      await Notification.deleteMany({ userId: req.user.id });
      res.json({ success: true });
    } catch (error) {
      console.error('Error clearing notifications:', error);
      res.status(500).json({ error: 'Error clearing notifications' });
    }
  }

  // Get unread count
  static async getUnreadCount(req, res) {
    try {
      const count = await Notification.getUnreadCount(req.user.id);
      res.json({ count });
    } catch (error) {
      console.error('Error getting unread count:', error);
      res.status(500).json({ error: 'Error getting unread count' });
    }
  }
}

module.exports = NotificationController;