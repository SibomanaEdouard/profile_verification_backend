const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  senderId:{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  resolved:{
    type:Boolean,
    default:false
  },
  type: {
    type: String,
    required: true,
    enum: [
      'PROFILE_PICTURE_SIMILARITY',
      'PROFILE_PICTURE_APPROVED',
      'PROFILE_PICTURE_REJECTED',
    ]
  },
  message: {
    type: String,
    required: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  status: {
    type: String,
    enum: ['unread', 'read'],
    default: 'unread'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  readAt: {
    type: Date
  },
  expiresAt: {
    type: Date,
    index: true
  }
});

// Add indexes for common queries
notificationSchema.index({ userId: 1, status: 1, createdAt: -1 });

// Instance methods
notificationSchema.methods.markAsRead = async function() {
  this.status = 'read';
  this.readAt = new Date();
  return this.save();
};

// Static methods
notificationSchema.statics.createNotification = async function(data) {
  const notification = new this({
    senderId: data.senderId,
    userId: data.userId,
    type: data.type,
    message: data.message,
    data: data.data,
    expiresAt: data.expiresAt
  });
  
  return notification.save();
};

notificationSchema.statics.getUnreadCount = async function(userId) {
  return this.countDocuments({
    userId,
    status: 'unread'
  });
};

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;