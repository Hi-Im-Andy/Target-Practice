'''
The main program used to run the Target Practice code.
'''

import ImageDectection as ID
import DataAnalysis as DA
import Tips
import Logger

__author__ = "Andy Hernandez"
__date__ = "01/23/2025"
__status__ = "Development"

def sample_run():
    # Points
    points = [(1, 2), (3, 3), (5, 6), (1, 1), (2, 1), (0, 1), (1, 0), (0, 0), (0.2, 1), (-0.1, -0.1), (0.01, -0.1), (-1, 1), (1, -1), (1, -1)]

    filtered_points = DA.filter_outliers(points)
    print(f"Filtered Points: {filtered_points}")

    # Closest and furthest hits
    print(f"Unfiltered: ")
    cp = DA.center_points(points)
    fh = DA.furthest_hit(points)
    nh = DA.nearest_hit(points)
    Tips.tips(cp, DA.grouping_size(points))
    DA.display_points(points, cp, nh, fh)

    print(f"Filtered: ")
    cp = DA.center_points(filtered_points)
    fh = DA.furthest_hit(filtered_points)
    nh = DA.nearest_hit(filtered_points)
    DA.grouping_size(filtered_points)
    Tips.tips(cp, DA.grouping_size(filtered_points))
    DA.display_points(filtered_points, cp, nh, fh)

if (__name__ == "__main__"):
    # Load the image
    print("Loading Main")
    sample_run()
    print("End of Main")