// const { string } = require('@tensorflow/tfjs-node');
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  linkedinId: {
    type: String,
    unique: true,
    sparse: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  education: [{
    institution: String,
    degree: String,
    fieldOfStudy: String,
    startDate: Date,
    endDate: Date
  }],
  workExperience: [{
    company: String,
    position: String,
    startDate: Date,
    endDate: Date
  }],
  nationalId: {
    idNumber: String,
    dateOfBirth: Date,
    verified: {
      type: Boolean,
      default: false
    },
    document: String // URL or path to stored document
  },
  profilePicture: {
    url: String,
    verified: {
      type: Boolean,
      default: false
    },
    tempPath:String
  },
  verificationStatus: {
    type: String,
    enum: ['pending', 'verified', 'rejected'],
    default: 'pending'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('ProductionUsers', userSchema);