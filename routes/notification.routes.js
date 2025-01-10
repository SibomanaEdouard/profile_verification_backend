const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const NotificationController = require('../controllers/NotificationController');
const Notification = require('../models/Notification');
const User = require('../models/User');

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

// profile decision from other users 
router.post('/profile-picture-decision', auth, async (req, res) => {
    try {
      const { notificationId, action } = req.body;
  
      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid action. Must be either "approve" or "reject"'
        });
      }
  
      // Find and validate the notification
      const notification = await Notification.findOne({
        _id: notificationId,
        userId: req.user.id

      });
  
      if (!notification) {
        return res.status(404).json({
          success: false,
          message: 'Notification not found or already resolved'
        });
      }
  
      // Get the user who requested to upload similar picture
      const requestingUser = await User.findById(notification.senderId);
      if (!requestingUser) {
        return res.status(404).json({
          success: false,
          message: 'Requesting user not found'
        });
      }
  
      let updateData;
      let notificationData;
  
      if (action === 'approve') {
        updateData = {
          'profilePicture.verified': true,
          'profilePicture.verifiedAt': new Date(),
          'profilePicture.verifiedBy': req.user.id,
          // Convert temp path to actual profile picture URL if it exists
          ...(requestingUser.profilePicture.tempPath && {
            'profilePicture.url': requestingUser.profilePicture.tempPath,
            'profilePicture.tempPath': null
          })
        };
  
        notificationData = {
          type: 'PROFILE_PICTURE_APPROVED',
          message: `${req.user.name} has approved  your profile picture`,
          data: {
            timestamp: new Date(),
            approverId: req.user.id,
            approverName: req.user.name
          }
        };
      } else {
        // Handle rejection
        updateData = {
          'profilePicture.url': null,
          'profilePicture.verified': false,
          'profilePicture.uploadedAt': null,
          'profilePicture.tempPath': null
        };
  
        notificationData = {
          type: 'PROFILE_PICTURE_REJECTED',
          message: `${req.user.name} has rejected your profile picture please use another one !`,
          data: {
            timestamp: new Date(),
            rejectorId: req.user.id,
            rejectorName: req.user.name 
          }
        };
      }
  
      // Update requesting user's profile
      const updatedUser = await User.findByIdAndUpdate(
        requestingUser._id,
        updateData,
        { new: true }
      );
  
      // Create notification for the requesting user
      await Notification.create({
        senderId: req.user._id,
        userId: requestingUser._id,
        ...notificationData,
        status: 'unread'
      });
  
      // Mark original notification as resolved
      await Notification.findByIdAndUpdate(notificationId, {
        status: 'read',
        readAt: new Date(),
        resolved: true,
        resolvedAt: new Date(),
        resolutionAction: action,
        resolvedBy: req.user.id
      });
  
      res.json({
        success: true,
        message: `Profile picture successfully ${action}d`,
        data: {
          action,
          userId: requestingUser._id,
          timestamp: new Date(),
          profilePictureStatus: updatedUser.profilePicture.verified
        }
      });
  
    } catch (error) {
      console.error('Error processing profile picture decision:', error);
      res.status(500).json({
        success: false,
        message: 'Error processing profile picture decision',
        error: error.message
      });
    }
  });

module.exports = router;