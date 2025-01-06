const Tesseract = require('tesseract.js');
const User = require('../models/User');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const axios = require('axios');
const { recognize } = require('tesseract.js');
class VerificationController {

  // this is to check if the uploaded id is really nationalId
  static async validateNationalId(file) {
    try {
      // Validate file type
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf'];
      if (!allowedMimeTypes.includes(file.mimetype)) {
        throw new Error('Invalid file type. Please upload an image or PDF.');
      }
  
      // Perform OCR
      const { data: { text } } = await recognize(file.path, 'eng');
  
      // Check for National ID-specific keywords
      const hasIdKeyword = /National ID|Names|Date of Birth/i.test(text);
  
      if (hasIdKeyword) {
        return true; 
      }
  
      return false; // The file does not match the expected format
    } catch (error) {
      console.error('Error validating National ID:', error);
      throw new Error('Failed to validate National ID.');
    }
  }


  // this is to preprocess 
    static async preprocessImage(filePath) {
    const processedPath = filePath.replace(/\.\w+$/, '_processed.png'); // Save as a new file
    await sharp(filePath)
      .grayscale()
      .resize(1000, null) // Resize while maintaining aspect ratio
      .toFile(processedPath);
    return processedPath;
  }
  

// this is the final  process of national id 
static async processNationalId(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const isValidId = await this.validateNationalId(req.file);
    if (!isValidId) {
      return res.status(400).json({ error: 'Uploaded file is not a valid National ID' });
    }

    const processedPath = await this.preprocessImage(req.file.path);
    const { data: { text } } = await recognize(processedPath, 'eng');
    const cleanText = text.replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').trim();

  //  parterns 
  const namePattern = /Names\s*:?\s*y?\s*([A-Za-z\s]+?)(?:\s*as|\s*\.|$)/i;
    const idPattern = /National\s*ID\s*(?:No\.?)?\s*[.,]?\s*([\d\s]+)(?:\s*\d?\s*\d?\s*$|\s*[A-Za-z]|$)/i;
    const dobPattern = /Date\s*of\s*Birth\s*(?:=~\s*>)?\s*\|?\s*y?\s*(\d{2}\/\d{2}\/\d{4})/i;


    // Extract and clean data
    const nameMatch = cleanText.match(namePattern);
    const idMatch = cleanText.match(idPattern);
    const dobMatch = cleanText.match(dobPattern);

    const name = nameMatch ? nameMatch[1].trim() : undefined;
    const idNumber = idMatch ? idMatch[1].replace(/\s+/g, '').trim() : undefined;
    let dateOfBirth = dobMatch ? dobMatch[1] : undefined;

    console.log("name : ",name ,"NationalId : " ,idNumber , "DOB : ", dateOfBirth)

    if (!name || !idNumber || !dateOfBirth) {
      return res.status(400).json({ error: 'Failed to extract all required fields' });
    }
    console.log("This is the logged user :  ",req.user)

    // this is to  compare the logged user's name with the name on the national id 
    if(req.user.name === name){
    let user = await User.findByIdAndUpdate(
      req.user.id,
      {
        'nationalId.idNumber': idNumber,
        'nationalId.dateOfBirth': new Date(dateOfBirth),
        'nationalId.document': req.file.path,
        'nationalId.verified': true,
      },
      { new: true }
    );
    // this is to save the  with the updated profile
    await user.save();

    res.json({
      message:"Your national id is verified successfully!",
      success: true,
      data: { name, idNumber, dateOfBirth },
    });
  }else{
    res.json({
      message:"The name in from linkedin is difference from the name on your naational Id , please update it to match! ",
      success:false,
      data:null,
    }
    )
  }
  } catch (error) {
    console.error('Error processing National ID:', error);
    res.status(500).json({ error: 'Error processing National ID' });
  }
}

  
  


 // Generate image signature for comparison
 static async generateImageSignature(imagePath) {
  try {
    // Resize image to small dimensions and convert to grayscale for consistent comparison
    const imageBuffer = await sharp(imagePath)
      .resize(32, 32, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

    // Create hash as image signature
    return crypto.createHash('sha256').update(imageBuffer).digest('hex');
  } catch (error) {
    console.error('Error generating image signature:', error);
    throw error;
  }
}

// Calculate similarity percentage between two signatures
static calculateSimilarity(sig1, sig2) {
  let differences = 0;
  const totalBits = sig1.length * 4; // Each hex character represents 4 bits
  
  for (let i = 0; i < sig1.length; i++) {
    const byte1 = parseInt(sig1[i], 16);
    const byte2 = parseInt(sig2[i], 16);
    differences += (byte1 ^ byte2).toString(2).replace(/0/g, '').length;
  }
  
  return 100 - (differences * 100 / totalBits);
}

// Process profile picture upload and check similarity
static async checkProfilePictureSimilarity(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('Processing uploaded file:', req.file.path);

    // Generate signature for uploaded image
    const uploadedSignature = await VerificationController.generateImageSignature(req.file.path);

    // Get all users with profile pictures
    const users = await User.find({
      'profilePicture.url': { $exists: true },
      _id: { $ne: req.user.id }
    });

    // Check for similar images
    const conflicts = await Promise.all(users.map(async user => {
      try {
        const existingSignature = await VerificationController.generateImageSignature(user.profilePicture.url);
        const similarity = VerificationController.calculateSimilarity(uploadedSignature, existingSignature);

        if (similarity > 85) { // Threshold for similarity
          return {
            userId: user._id,
            username: user.username,
            similarity: similarity.toFixed(2)
          };
        }
      } catch (error) {
        console.error(`Error comparing with user ${user._id}:`, error);
      }
      return null;
    }));

    const validConflicts = conflicts.filter(Boolean);

    if (validConflicts.length > 0) {
      // Store temporary file path
      await User.findByIdAndUpdate(req.user.id, {
        'profilePicture.tempPath': req.file.path
      });

      // Create notifications for existing users
      await Promise.all(validConflicts.map(conflict => 
        global.Notification.createNotification({
          userId: conflict.userId,
          type: 'PROFILE_PICTURE_SIMILARITY',
          message: 'Someone attempted to upload a profile picture similar to yours',
          data: {
            similarity: conflict.similarity,
            timestamp: new Date(),
            uploaderId: req.user.id
          }
        })
      ));

      return res.json({
        success: false,
        conflicts: validConflicts,
        tempPath: req.file.path,
        message: 'Similar profile pictures found'
      });
    }

    // If no conflicts, proceed with upload
    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        'profilePicture.url': req.file.path,
        'profilePicture.verified': true,
        'profilePicture.uploadedAt': new Date()
      },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Profile picture uploaded successfully',
      profilePicture: user.profilePicture
    });

  } catch (error) {
    console.error('Error processing profile picture:', error);
    res.status(500).json({ error: 'Error processing profile picture' });
  }
}

// Handle user's decision about conflict
static async resolveProfilePictureConflict(req, res) {
  try {
    const { action } = req.body;
    const user = await User.findById(req.user.id);
    const tempPath = user.profilePicture?.tempPath;

    if (!tempPath) {
      return res.status(400).json({ error: 'No pending profile picture upload found' });
    }

    if (action === 'proceed') {
      // Update user's profile picture
      const updatedUser = await User.findByIdAndUpdate(
        req.user.id,
        {
          'profilePicture.url': tempPath,
          'profilePicture.verified': true,
          'profilePicture.uploadedAt': new Date(),
          'profilePicture.tempPath': null
        },
        { new: true }
      );

      res.json({
        success: true,
        message: 'Profile picture updated successfully',
        profilePicture: updatedUser.profilePicture
      });
    } else {
      // Cancel upload
      await User.findByIdAndUpdate(req.user.id, {
        'profilePicture.tempPath': null
      });

      res.json({
        success: true,
        message: 'Upload cancelled successfully'
      });
    }
  } catch (error) {
    console.error('Error resolving profile picture conflict:', error);
    res.status(500).json({ error: 'Error resolving profile picture conflict' });
  }
}


// Notify user of similar profile picture upload
static async notifyProfilePictureSimilarity(req, res) {
  try {
    const { userId, similarityDetails } = req.body;

    // Get user details
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create notification
    const notification = new Notification({
      userId: user._id,
      type: 'PROFILE_PICTURE_SIMILARITY',
      message: 'Someone attempted to upload a profile picture similar to yours',
      data: similarityDetails,
      status: 'unread'
    });

    await notification.save();

    res.json({
      success: true,
      message: 'Notification sent successfully'
    });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ error: 'Error sending notification' });
  }
}
}

module.exports = VerificationController;