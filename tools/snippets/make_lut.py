"""Write film-look 3D LUTs (.cube, 33^3): 'night' (soft S-curve, lifted blacks, teal shadows, warm highlights, gentle
desaturation, highlight roll-off), 'noir' (red-filter black and white, deep contrast, faint cool tint), 'flex'
(punchier contrast, cyan shadows, amber highlights). Usage: python -I make_lut.py <out_dir>"""
import sys
import numpy as np

N = 33
g = np.linspace(0, 1, N)
b, gg, r = np.meshgrid(g, g, g, indexing="ij")          # .cube order: red changes fastest
rgb = np.stack([r, gg, b], axis=-1).reshape(-1, 3)


def scurve(x, toe=0.04, shoulder=0.96, k=1.25):
    y = 0.5 + (x - 0.5) * k
    y = 1 / (1 + np.exp(-(x - 0.5) * 5.0 * k)) * 0.9 + 0.05 * x + 0.05 * y
    lo, hi = y.min(), y.max()
    y = (y - lo) / (hi - lo)
    return toe + y * (shoulder - toe)


def write(name, out):
    with open(f"{sys.argv[1]}/{name}.cube", "w") as f:
        f.write(f'TITLE "{name}"\nLUT_3D_SIZE {N}\n')
        for v in np.clip(out, 0, 1):
            f.write(f"{v[0]:.5f} {v[1]:.5f} {v[2]:.5f}\n")


lum = (rgb @ np.array([0.2126, 0.7152, 0.0722]))[:, None]
# night
x = lum + (rgb - lum) * 0.62                               # desaturate
x = scurve(x, toe=0.045, shoulder=0.94, k=1.15)
l2 = (x @ np.array([0.2126, 0.7152, 0.0722]))[:, None]
sh, hi = np.clip(1 - l2 * 2.2, 0, 1), np.clip((l2 - 0.55) * 2.2, 0, 1)
x = x + sh * np.array([-0.035, 0.012, 0.045]) + hi * np.array([0.045, 0.018, -0.03])
write("night", x)
# noir
bw = rgb @ np.array([0.45, 0.45, 0.10])                    # red-ish filter: darker skies, brighter skin
bw = scurve(bw, toe=0.02, shoulder=0.97, k=1.45)[:, None]
write("noir", np.repeat(bw, 3, axis=1) + np.array([-0.006, 0.0, 0.012]))
# flex
x = lum + (rgb - lum) * 0.95
x = scurve(x, toe=0.02, shoulder=0.97, k=1.35)
l2 = (x @ np.array([0.2126, 0.7152, 0.0722]))[:, None]
sh, hi = np.clip(1 - l2 * 2.0, 0, 1), np.clip((l2 - 0.5) * 2.0, 0, 1)
x = x + sh * np.array([-0.03, 0.02, 0.05]) + hi * np.array([0.06, 0.03, -0.035])
write("flex", x)
print("luts written")
