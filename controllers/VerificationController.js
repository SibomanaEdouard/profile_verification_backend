const Tesseract = require('tesseract.js');
// const Jimp = require('jimp');
const User = require('../models/User');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

class VerificationController {
  static async processNationalId(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Log the received file details
      console.log('Received file:', {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        path: req.file.path
      });

      // Perform OCR on the uploaded ID
      const { data: { text } } = await Tesseract.recognize(
        req.file.path,
        'eng',
        { logger: m => console.log(m) }
      );

      // Extract relevant information
      const idNumber = text.match(/ID:\s*([A-Z0-9]+)/i)?.[1];
      const dateOfBirth = text.match(/DOB:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1];
      const name = text.match(/Name:\s*([A-Za-z\s]+)/i)?.[1];

      // Update user document
      const user = await User.findByIdAndUpdate(
        req.user.id,
        {
          'nationalId.idNumber': idNumber,
          'nationalId.dateOfBirth': dateOfBirth ? new Date(dateOfBirth) : undefined,
          'nationalId.document': req.file.path,
          'nationalId.verified': true
        },
        { new: true }
      );

      res.json({
        success: true,
        data: {
          idNumber,
          dateOfBirth,
          name
        }
      });
    } catch (error) {
      console.error('Error processing National ID:', error);
      res.status(500).json({ error: 'Error processing National ID' });
    }
  }




  // // Check profile picture similarity
  // static async checkProfilePictureSimilarity(req, res) {
  //   try {
  //     if (!req.file) {
  //       return res.status(400).json({ error: 'No file uploaded' });
  //     }

  //     console.log('Uploaded file path:', req.file.path);
  //     // Load the uploaded image
  //     const uploadedImage = await Jimp.default.read(req.file.path);
  //     // const uploadedImage = await Jimp.read(req.file.path);

      
  //     // Get all users with profile pictures
  //     const users = await User.find({
  //       'profilePicture.url': { $exists: true },
  //       _id: { $ne: req.user.id }
  //     });

  //     let conflicts = [];

  //     // Compare with existing profile pictures
  //     for (const user of users) {
  //       const existingImage = await Jimp.default.read(user.profilePicture.url);
  //       console.log('Existing profile picture URL:', user.profilePicture.url);
        
  //       // Calculate image similarity 
  //       const distance = Jimp.distance(uploadedImage, existingImage);
  //       const similarity = 1 - distance;

  //       if (similarity > 0.8) { // Threshold for similarity
  //         conflicts.push({
  //           userId: user._id,
  //           similarity: similarity * 100
  //         });
  //       }
  //     }

  //     if (conflicts.length > 0) {
  //       res.json({
  //         success: false,
  //         conflicts,
  //         message: 'Similar profile pictures found'
  //       });
  //     } else {
  //       // Save the profile picture if no conflicts
  //       const user = await User.findByIdAndUpdate(
  //         req.user.id,
  //         {
  //           'profilePicture.url': req.file.path,
  //           'profilePicture.verified': true
  //         },
  //         { new: true }
  //       );

  //       res.json({
  //         success: true,
  //         message: 'Profile picture uploaded successfully'
  //       });
  //     }
  //   } catch (error) {
  //     console.error('Error processing profile picture:', error);
  //     res.status(500).json({ error: 'Error processing profile picture' });
  //   }
  // }



//  // Generate image hash for comparison
 static async generateImageHash(imagePath) {
  try {
    // Resize image to small dimensions for consistent comparison
    const imageBuffer = await sharp(imagePath)
      .resize(32, 32, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

    // Create hash from image data
    return crypto.createHash('sha256').update(imageBuffer).digest('hex');
  } catch (error) {
    console.error('Error generating image hash:', error);
    throw error;
  }
}

// // Calculate image difference percentage
static async calculateImageDifference(hash1, hash2) {
  let diff = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) diff++;
  }
  return (1 - diff / hash1.length) * 100;
}

// Helper method for reliable file deletion
static async safeDeleteFile(filePath) {
  try {
    await fs.access(filePath); // Check if file exists
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code === 'EPERM') {
      console.warn(`File locked, retrying delete for: ${filePath}`);
      // Wait briefly before retrying
      await new Promise(resolve => setTimeout(resolve, 200));
      try {
        await fs.unlink(filePath);
      } catch (retryError) {
        console.warn(`Could not delete file ${filePath} on retry:`, retryError);
      }
    } else if (error.code !== 'ENOENT') { // Ignore "file not found" errors
      throw error;
    }
  }
}


// Helper method for safe file moving
static async safeMoveFile(sourcePath, targetPath) {
  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    await VerificationController.safeDeleteFile(sourcePath);
  } catch (error) {
    throw new Error(`Failed to move file from ${sourcePath} to ${targetPath}: ${error.message}`);
  }
}

static async checkProfilePictureSimilarity(req, res) {
  const uploadedFilePath = req.file?.path;
  let tempPath = null;

  try {
    if (!uploadedFilePath) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('Processing uploaded file:', uploadedFilePath);

    // Generate hash for uploaded image
    const uploadedHash = await VerificationController.generateImageHash(uploadedFilePath);

    // Get and compare with existing profile pictures
    const users = await User.find({
      'profilePicture.url': { $exists: true },
      _id: { $ne: req.user.id }
    });

    const conflicts = await Promise.all(users.map(async user => {
      try {
        const existingHash = await VerificationController.generateImageHash(user.profilePicture.url);
        const similarity = await VerificationController.calculateImageDifference(uploadedHash, existingHash);

        if (similarity > 85) {
          return {
            userId: user._id,
            username: user.username,
            similarity: similarity.toFixed(2),
            profilePicture: user.profilePicture.url
          };
        }
      } catch (error) {
        console.error(`Error comparing with user ${user._id}:`, error);
      }
      return null;
    })).then(results => results.filter(Boolean));

    if (conflicts.length > 0) {
      // Move to temp directory instead of copy+delete
      const tempDir = path.join(__dirname, '../temp');
      await fs.mkdir(tempDir, { recursive: true });
      tempPath = path.join(tempDir, `temp_${req.user.id}_${Date.now()}${path.extname(req.file.originalname)}`);
      await VerificationController.safeMoveFile(uploadedFilePath, tempPath);

      // Create notifications
      if (global.Notification) {
        await Promise.all(conflicts.map(conflict =>
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
      }

      return res.json({
        success: false,
        conflicts,
        tempPath,
        message: 'Similar profile pictures found'
      });
    }

    // Process and save the profile picture
    const uploadsDir = path.join(__dirname, '../uploads');
    await fs.mkdir(uploadsDir, { recursive: true });
    const fileName = `profile_${req.user.id}_${Date.now()}${path.extname(req.file.originalname)}`;
    const finalPath = path.join(uploadsDir, fileName);

    // Optimize image
    await sharp(uploadedFilePath)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(finalPath);

    await VerificationController.safeDeleteFile(uploadedFilePath);

    // Update user profile
    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        'profilePicture.url': finalPath,
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
    
    // Clean up any files if error occurs
    if (uploadedFilePath) {
      await VerificationController.safeDeleteFile(uploadedFilePath);
    }
    if (tempPath) {
      await VerificationController.safeDeleteFile(tempPath);
    }
    
    res.status(500).json({ error: 'Error processing profile picture' });
  }
}

// Handle conflict resolution
static async resolveProfilePictureConflict(req, res) {
  try {
    const { tempPath, action } = req.body;

    if (action === 'proceed') {
      const uploadsDir = path.join(__dirname, '../uploads');
      await fs.mkdir(uploadsDir, { recursive: true });
      const fileName = `profile_${req.user.id}_${Date.now()}${path.extname(tempPath)}`;
      const finalPath = path.join(uploadsDir, fileName);

      // Optimize and save the image
      await sharp(tempPath)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(finalPath);

      // Update user profile
      const user = await User.findByIdAndUpdate(
        req.user.id,
        {
          'profilePicture.url': finalPath,
          'profilePicture.verified': true,
          'profilePicture.uploadedAt': new Date()
        },
        { new: true }
      );

      // Clean up temp file
      await fs.unlink(tempPath);

      res.json({
        success: true,
        message: 'Profile picture updated successfully',
        profilePicture: user.profilePicture
      });
    } else {
      // Clean up temp file if user cancels
      await fs.unlink(tempPath);
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