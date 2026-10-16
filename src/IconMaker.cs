using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
class IconMaker {
  static void Main(string[] args) {
    using (Bitmap image = new Bitmap(64, 64)) {
      using (Graphics g = Graphics.FromImage(image)) {
        g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(Color.FromArgb(16, 125, 119));
        PointF[] star = new PointF[10];
        for (int i = 0; i < 10; i++) { double a = -Math.PI / 2 + i * Math.PI / 5; double r = (i % 2 == 0) ? 24 : 10; star[i] = new PointF((float)(32 + Math.Cos(a) * r), (float)(32 + Math.Sin(a) * r)); }
        g.FillPolygon(Brushes.White, star);
      }
      using (Icon icon = Icon.FromHandle(image.GetHicon()))
      using (FileStream output = File.Create(args[0])) icon.Save(output);
    }
  }
}
