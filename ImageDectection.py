'''
The image manipulation for the computer vision.
'''

import cv2
import numpy as np
import os

FOLDER = "Images/Training/"

def filter_images():
    '''
    Used to iterate through all of the images in a folder and return possible hit locations.

    Args:
        None

    Returns:
        shot_positions (list): The coordinates of all of the shots.
    '''
    image_files = [os.path.join(FOLDER, f) for f in os.listdir(FOLDER) if f.endswith(('.png', '.jpg', '.jpeg'))]
    print("Files:", image_files)

    for image_file in image_files:
        image = cv2.imread(image_file)
        cv2.imshow("Image", image)
        cv2.waitKey(0)
    cv2.destroyAllWindows()

    # Need to adjust the parameters to better identify shots
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, thresh = cv2.threshold(blurred, 200, 255, cv2.THRESH_BINARY_INV)

    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    shot_positions = []

    height, width = image.shape[:2]
    # Creating a 10x10 grid for now, should be made to measurement of the target in inches
    grid_size = (10, 10)

    for contour in contours:
        # Calculate the bounding box
        x, y, w, h = cv2.boundingRect(contour)
        cx, cy = x + w // 2, y + h // 2

        # Map the centroid to the target grid
        grid_x = int((cx / width) * grid_size[0])
        grid_y = int((cy / height) * grid_size[1])

        # Append to shot positions
        shot_positions.append((grid_x, grid_y))

        # Optionally, visualize the detections
        cv2.circle(image, (cx, cy), 5, (0, 255, 0), -1)
        cv2.putText(image, f"{grid_x},{grid_y}", (cx, cy), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 0, 0), 1)

    # Show the image with detections
    cv2.imshow("Detected Shots", image)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

    # Output the shot positions as an array
    print("Shot Positions:", shot_positions)
    return shot_positions

def image_transform(image):
    '''
    Used to determine the grid positioning on the non-uniform image.

    Args:
        image (var): The processed image

    Returns:
        grid_image: The same image with a grid overlayed
    '''
    # Overlay a grid on the image
    grid_size = 10
    height, width, _ = image.shape
    grid_x = width // grid_size
    grid_y = height // grid_size
    

    grid_image = image
    return grid_image
    # Identify corners on the image
        # Turn black and white
        # Use a gaussian blur 
        # Use a threshold to make it binary
        # Find contours of the image
        # Draw a rectangle around the contours
        # Find the outermost corners
        # Return the centers of those corners

    # Transform grid to line up with the image corners

