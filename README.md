# Target Practice
Using python for machine learning and data analysis of targets for scoring and zeroing.

## Use Cases
Ideally, the program should be used as a tool to aid in shooting style sports. This includes but is not limited to the following:
+ Airsoft
+ Paintball
+ Archery
+ Competetive Shooting

After a user has completed their session, they should be able to upload an image of the target and have this program analyze it. There is the additional benefit of feedback being provided to assist in changes to either the person or equipment being used.

# Components
The program consists of 3 main components: Data acquisition, data analysis, and feedback.

## Data Acquisition
The user will upload an image of the target. The image is then manipulated to black and white along with a blur added to assist with the recognition of impacts. The image then has a cartesian plane overlayed and transformed. Any detected impacts will have the coordinates extracted and placed in an array in preperation for the data analysis.

## Data Analysis
The data analysis will take the array of coordinates and perform a variety of statistical analysis to determine the accuracy of each shot as well as the entirety of shots. Outliers may be removed during this process to ensure that there is minimal screw. From the data analysis, we can get:
+ Closest shot (Closest to the origin / bullseye)
+ Furthest shot (both with and without outliers)
+ Shot group size
+ Median shot placement (Average of all of the shots)
+ Standard deviation of shot placement (Spread of the shots)

This data is visualized on a grid and can then be interpreted to return meaningful information as feedback.

## Feedback
The feedback is in the form of a few sentences. The main feedback will stem from the positioning of the median. If the median is too, high, the user will be told to aim lower. There will also be a breakdown of what can cause these issues. This breakdown will be dependant on the sport, what may cause a high shot in airsoft may not translate directly to archery. Grouping is also something that is taken into account depending on the distance. A larger group size at a distance may be comparable to that of a smaller one up close. All feedback is meant to provide the user with a better understanding of what they can do to improve their accuracy, precision, and equipement as needed.

# To DO 
The main part that needs to be completed is the data acquisition section. The images need to be manipulated better to determine the locations of impacts, differentiate impacts from the target, and have the coordinates extracted.