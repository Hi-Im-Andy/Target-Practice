'''
Functions that provide feedback to the user based on the data.
'''

def tips(center, group_size):
  '''
  Provides feedback in the form of tips.

  Args:
    center (int): The center of the group.
    group_size (float): the size of the group.

  Returns:
    None
  '''
  cx = center[0]
  cy = center[1]

  if (cy > 0):
    print("""The shot is too high, possible issues include:
          1. The hop is set too high.
          2. The grip is pushing the gun up.
          3. The sight is aligned too low
          """)

  if (cy < 0):
    print("""The shot is too low, possible issues include:
          1. The hop is set too low.
          2. Trigger finger is pulling the gun down.
          3. The sight is aligned too high.
          4. At a distance, bullet drop will become a greater factor.
          """)

  if (cx > 0):
    print("""The shot placement is to the right, possible issues include:
          1. Trigger finger is pulling the gun to the right.
          2. The sight is aligned too far to the left.
          """)

  if (cx < 0):
    print("""The shot placement is to the left, possible issues include:
          1. Trigger finger is pushing the gun to the left.
          2. The sight is aligned too far to the right.
          """)

  if (group_size > 2):
    print("Grouping is too large, work on accuracy.")
  else:
    print("Grouping is ideal, good job.")
