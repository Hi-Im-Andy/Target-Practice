import math
import matplotlib.pyplot as plt


def center_points(points):
  '''
  Calculates the median shot placement.

  
  '''
  average_x = sum(point[0] for point in points) / len(points)
  average_y = sum(point[1] for point in points) / len(points)
  print(f"Shots Center ({average_x}, {average_y})")
  center = (average_x, average_y)
  return center

def filter_outliers(points):
  average_x = sum(point[0] for point in points) / len(points)
  average_y = sum(point[1] for point in points) / len(points)
  filtered_points = [point for point in points if abs(point[0] - average_x) < 2 and abs(point[1] - average_y) < 2]
  return filtered_points

def nearest_hit(points):
  min_distance = float('inf')
  closest_point = None
  for point in points:
    distance = math.sqrt(point[0]**2 + point[1]**2)
    if distance < min_distance:
      min_distance = distance
      closest_point = point
  print(f"Nearest Hit ({closest_point[0]}, {closest_point[1]})")
  return closest_point

def furthest_hit(points):
  # Allowing unbound value
  max_distace = float('-inf')
  furthest_point = None
  for point in points:
    distance = math.sqrt(point[0]**2 + point[1]**2)
    if distance > max_distace:
      max_distace = distance
      furthest_point = point
  print(f"Furthest Hit ({furthest_point[0]}, {furthest_point[1]})")
  return furthest_point

def grouping_size(points):
  dx = 0
  dy = 0
  for i in range(len(points)):
    for j in range(i + 1, len(points)):
      if (dx < abs(points[i][0] - points[j][0])):
        dx = abs(points[i][0] - points[j][0])
      if (dy < abs(points[i][1] - points[j][1])):
        dy = abs(points[i][1] - points[j][1])
  distance = (dx, dy)
  distance = math.sqrt(distance[0]**2 + distance[1]**2)
  print(f"Grouping Size: ({dx}, {dy}) : {distance}")
  return distance

def display_points(points, center, nearest, furthest):
    x_coords, y_coords = zip(*points)
    plt.figure(figsize=(8, 8))
    plt.scatter(x_coords, y_coords, color = 'black',label='Hits')
    plt.scatter(center[0], center[1], color='green', label='Center')
    plt.scatter(nearest[0], nearest[1], color='blue', label='Nearest')
    plt.scatter(furthest[0], furthest[1], color='red', label='Furthest')

    plt.axhline(0, color='black', linewidth=0.5)
    plt.axvline(0, color='black', linewidth=0.5)

    plt.xlim(-10, 10)
    plt.ylim(-10, 10)
    plt.xlabel("X-axis")
    plt.ylabel("Y-axis")
    plt.title("Shots on Target")
    plt.legend()
    plt.grid(True)
    plt.show()