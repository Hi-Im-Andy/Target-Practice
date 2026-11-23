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

![Example Figure](https://github.com/user-attachments/assets/47f6b8b3-62d4-4ac6-9254-0721c7b75fde)

![Example Figure 2](https://github.com/user-attachments/assets/f81a6674-eaab-47be-b0aa-44f6670b6f8e)

## Feedback
The feedback is in the form of a few sentences. The main feedback will stem from the positioning of the median. If the median is too, high, the user will be told to aim lower. There will also be a breakdown of what can cause these issues. This breakdown will be dependant on the sport, what may cause a high shot in airsoft may not translate directly to archery. Grouping is also something that is taken into account depending on the distance. A larger group size at a distance may be comparable to that of a smaller one up close. All feedback is meant to provide the user with a better understanding of what they can do to improve their accuracy, precision, and equipement as needed.

![Output](https://github.com/user-attachments/assets/436253f9-fbec-4011-a14a-2f260877d46a)

# Phone web app
`web/` holds a phone-friendly web app that does the whole pipeline on the device (no upload):

1. **Photo**: take or pick a photo of the shot target, and choose the paper size, ammo and (optionally) distance.
2. **Corners**: the paper's corners are auto-detected (a Hough line search for the strongest straight-edged quadrilateral). You confirm them or drag them, with a magnifier.
3. **Aim point**: the photo is straightened to the real paper size and you tap where you aimed. This is remembered per target size.
4. **Results**: hits, group size (extreme spread), group center offset and clock direction, mean radius, horizontal/vertical SD, flyers, and airsoft feedback. **Edit hits** lets you tap to remove a false hit or add a missed one. Hits you remove are remembered as printed marks for that target size and hidden next time.

Run it: open `docs/index.html` (one self-contained file), or serve `web/` (`python3 -m http.server -d web`).
GitHub Pages can serve it from `main /docs`. After editing `web/`, rebuild with `python3 tools/build_web.py`.

## How hole detection works (`web/tp-core.js`)
- The paper is warped to a fixed pixels-per-inch so a hole is about 10 px across.
- Per colour channel, morphological top-hats find small light blobs (holes in black ink) and small dark blobs (holes in white paper). Each response only counts where the surroundings make sense for it.
- Small rings are filled (a dark-backed hole shows only its torn-fibre ring), then a small opening erases thin printed lines and digit strokes.
- Touching holes are split at distance-transform peaks. Each candidate must be round (or elongated and big enough to be 2 or 3 merged BBs), the right size, and must differ from its surroundings all the way round. Gaps between printed strokes and lines of printed text are rejected.

## Testing
There are no real shot photos yet, so `tools/make_synthetic.py` adds realistic 6 mm BB holes (ragged edges, torn fibres, cardboard/wall/dark backgrounds, touching pairs, blur, JPEG) at known positions to the training photos.

```
python3 tools/make_synthetic.py     # writes web/test/data/ (git-ignored)
node web/test/run_tests.js          # unit checks + detection accuracy
node web/test/run_tests.js --corners auto --verbose
python3 tools/build_web.py && python3 web/test/ui_test.py   # end-to-end in headless Chrome
```

Current results on 117 synthetic holes over 9 images, with confirmed corners: **~89% of holes found, ~0.02 in position error**. On this busy silhouette target there are ~2–8 false hits per photo, almost all printed marks (the X's, a 9, header text) or a hand in the frame. Those are tapped away once and then remembered. Auto corner detection works on a contrasting background (photo 1: 37/39 holes) but not on white paper against a white wall or when part of the paper is out of frame, which is why corners are always confirmed.

# To Do
- Test and tune with real shot targets (detection thresholds were tuned on synthetic holes).
- Zone scoring for known targets (X/9/8/7 rings).
- Feedback for other sports (archery, paintball, firearms).
