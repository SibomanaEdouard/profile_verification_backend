const passport = require('passport');
const LinkedInStrategy = require('passport-linkedin-oauth2').Strategy;
const User = require('../models/User');
const jwt = require('jsonwebtoken');

const initializePassport = (passport) => {
    passport.use(new LinkedInStrategy({
        clientID: process.env.LINKEDIN_CLIENT_ID,
        clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
        callbackURL: process.env.LINKEDIN_CALLBACK_URL,
        scope: ['openid', 'profile','email'],
        state: true
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            console.log('LinkedIn profile received:',profile);

            let user = await User.findOne({ linkedinId: profile.id });

            if (!user) {
                console.log('Creating new user');
                user = await User.create({
                    linkedinId: profile.id,
                    email: profile.email,
                    name: `${profile.givenName} ${profile.familyName}`,
                    education:profile.education,
                    profilePicture:profile.picture,
                    workExperience:profile.workExperience,
                    nationalId:profile.nationalId,
                    verificationStatus:profile.verificationStatus
                });
            } else {
                console.log('Existing user found');
            }
            console.log("The user : ",user)
            return done(null, user);
        } catch (error) {
            console.error('LinkedIn strategy error:', error);
            return done(error, null);
        }
    }));

    passport.serializeUser((user, done) => {
        done(null, user.id);
    });

    passport.deserializeUser(async (id, done) => {
        try {
            const user = await User.findById(id);
            done(null, user);
        } catch (error) {
            done(error, null);
        }
    });
};

const generateToken = (user) => {
    try {
        return jwt.sign(
            { 
                id: user._id, 
                email: user.email,
                linkedinId: user.linkedinId
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
    } catch (error) {
        console.error('Token generation error:', error);
        throw error;
    }
};

module.exports = { initializePassport, generateToken };