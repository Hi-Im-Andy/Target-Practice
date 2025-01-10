import cv2
import numpy as np
import os

folder_path = "Images/Training/"

# List all files in the folder
image_files = [os.path.join(folder_path, f) for f in os.listdir(folder_path) if f.endswith(('.png', '.jpg', '.jpeg'))]
print("Files:", image_files)

for image_file in image_files:
    image = cv2.imread(image_file)
    # Process the image as needed
    cv2.imshow("Image", image)
    cv2.waitKey(0)
cv2.destroyAllWindows()

# Preprocess the image
gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
blurred = cv2.GaussianBlur(gray, (5, 5), 0)
_, thresh = cv2.threshold(blurred, 200, 255, cv2.THRESH_BINARY_INV)

# Detect contours (potential shot holes)
contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

# Initialize a list to hold shot positions
shot_positions = []

# Define target grid dimensions
height, width = image.shape[:2]
grid_size = (10, 10)  # Assume a 10x10 grid for simplicity

# Process each contour
for contour in contours:
    # Calculate the bounding box and centroid
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
