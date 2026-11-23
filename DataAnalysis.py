import math
import matplotlib.pyplot as plt


def center_points(points):
  '''
  Calculates the mean point of impact (the average of all shots).

  Args:
    points (list): (x, y) shot coordinates, origin at the aim point.

  Returns:
    center (tuple): (x, y) average position.
  '''
  average_x = sum(point[0] for point in points) / len(points)
  average_y = sum(point[1] for point in points) / len(points)
  print(f"Shots Center ({average_x}, {average_y})")
  center = (average_x, average_y)
  return center

def _median(values):
  s = sorted(values)
  m = len(s) // 2
  return s[m] if len(s) % 2 else 0.5 * (s[m - 1] + s[m])

def filter_outliers(points, factor=2.5):
  '''
  Removes flyers: shots much further from the median center than is typical.
  Uses the median so the flyers themselves do not drag the center (the same
  rule as the web app). Needs at least 5 shots; otherwise returns all points.

  Args:
    points (list): (x, y) shot coordinates.
    factor (float): how many median radii away counts as a flyer.

  Returns:
    filtered_points (list): points without flyers.
  '''
  if len(points) < 5:
    return list(points)
  cx = _median([p[0] for p in points])
  cy = _median([p[1] for p in points])
  radii = [math.hypot(p[0] - cx, p[1] - cy) for p in points]
  med_r = _median(radii)
  if med_r == 0:
    return list(points)
  return [p for p, r in zip(points, radii) if not (r > factor * med_r and r > 0.5)]

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
  '''
  Extreme spread: the distance between the two shots furthest apart.
  (The old version combined the largest x gap and largest y gap from
  different pairs of shots, which overstated the group.)
  '''
  distance = 0.0
  for i in range(len(points)):
    for j in range(i + 1, len(points)):
      distance = max(distance, math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]))
  print(f"Grouping Size: {distance}")
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