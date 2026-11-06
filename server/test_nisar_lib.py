import unittest
import numpy as np

import nisar_lib as L


class ArrayDataset:
    def __init__(self, values):
        self.values = np.asarray(values)
        self.shape = self.values.shape

    def __getitem__(self, key):
        return self.values[key]


class GcovMaskTests(unittest.TestCase):
    def test_invalid_mask_values_are_excluded_before_averaging(self):
        data = ArrayDataset([[1.0, 100.0, 3.0, 200.0], [5.0, 300.0, 7.0, 400.0]])
        mask = ArrayDataset([[1, 0, 255, 2], [1, 0, 255, 2]])
        result = L.blockmean(data, step=2, positive_only=True, mask_ds=mask)
        self.assertEqual(result.shape, (1, 2))
        self.assertAlmostEqual(float(result[0, 0]), 3.0)
        self.assertAlmostEqual(float(result[0, 1]), 300.0)

    def test_valid_mask_samples_are_averaged(self):
        data = ArrayDataset([[2.0, 4.0, 6.0, 8.0], [2.0, 4.0, 6.0, 8.0]])
        mask = ArrayDataset([[1, 2, 3, 254], [1, 2, 3, 254]])
        result = L.blockmean(data, step=2, positive_only=True, mask_ds=mask)
        np.testing.assert_allclose(result, [[3.0, 7.0]])

    def test_mask_shape_mismatch_fails_closed(self):
        data = ArrayDataset([[1.0, 2.0], [3.0, 4.0]])
        mask = ArrayDataset([[1, 2]])
        with self.assertRaisesRegex(RuntimeError, "mask shape"):
            L.blockmean(data, step=1, mask_ds=mask)

    def test_positive_power_filter_still_excludes_nonpositive_values(self):
        data = ArrayDataset([[0.0, -1.0, 2.0, 4.0], [0.0, -1.0, 2.0, 4.0]])
        mask = ArrayDataset([[1, 1, 1, 1], [1, 1, 1, 1]])
        result = L.blockmean(data, step=2, positive_only=True, mask_ds=mask)
        self.assertTrue(np.isnan(result[0, 0]))
        self.assertAlmostEqual(float(result[0, 1]), 3.0)


if __name__ == "__main__":
    unittest.main()
