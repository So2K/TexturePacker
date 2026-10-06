using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using TexturePacker.Core;

namespace TexturePacker.Desktop;

/// <summary>Runs real desktop bindings and commands without showing windows or dialogs.</summary>
internal static class DesktopSmoke
{
    public static async Task RunAsync(string outputDirectory)
    {
        var directory = Path.GetFullPath(outputDirectory);
        Directory.CreateDirectory(directory);
        var checks = new List<string>();
        var window = new MainWindow();
        _ = new System.Windows.Interop.WindowInteropHelper(window).EnsureHandle();
        var vm = window.ViewModel;
        var bindingErrors = new BindingTrace();
        PresentationTraceSources.DataBindingSource.Listeners.Add(bindingErrors);
        PresentationTraceSources.DataBindingSource.Switch.Level = SourceLevels.Warning;
        try
        {
            var color = WriteFixture(directory, "color.png", 0);
            var mask = WriteFixture(directory, "mask.png", 1);
            var normal = WriteFixture(directory, "normal.png", 2);
            var tiff = WriteFixture(directory, "source.tiff", 0);
            await Capture(window, Path.Combine(directory, "01-empty.png"));
            foreach (var mode in vm.Modes)
            {
                vm.SelectedMode = mode;
                if (mode.Mode == TextureMode.ChannelPacking)
                    await vm.LoadFilesAsync([color, mask, normal]);
                else if (mode.Mode == TextureMode.CombineAlpha)
                    await vm.LoadFilesAsync([color, mask]);
                else if (mode.Mode == TextureMode.Convert16To8)
                    await vm.LoadFilesAsync([tiff]);
                else if (mode.Mode == TextureMode.Atlas)
                {
                    vm.AtlasColumns = 2;
                    vm.AtlasRows = 2;
                    await vm.LoadFilesAsync([color, mask, normal]);
                }
                else
                    await vm.LoadFilesAsync([normal]);

                Require(vm.CanProcess, $"{mode.Mode}: process enabled after import");
                if (mode.Mode == TextureMode.Atlas)
                    await Capture(window, Path.Combine(directory, "01-atlas-inputs.png"));
                await vm.ProcessCommand.ExecuteAsync();
                Require(vm.HasResult && !vm.HasError && !vm.IsBusy, $"{mode.Mode}: output available; {vm.ErrorMessage}");
                Require(vm.SaveCommand.CanExecute(null), $"{mode.Mode}: export enabled");
                checks.Add($"{mode.Mode}: imported, processed, output/export ready");
                await Capture(window, Path.Combine(directory, $"02-{mode.Mode}.png"));
            }

            vm.InvertG = !vm.InvertG;
            Require(!vm.HasResult && !vm.SaveCommand.CanExecute(null), "Changed inversion invalidates saved output");
            checks.Add("Settings invalidate stale output");
            vm.SelectedMode = vm.Modes[0];
            Require(vm.Slots.Count(s => s.HasFile) == 3, "Mode switch preserves source textures");
            vm.ClearCommand.Execute(null);
            Require(vm.Slots.All(s => !s.HasFile), "Clear removes source textures");
            await vm.LoadFilesAsync([Path.Combine(directory, "missing.png")]);
            Require(vm.HasError && !vm.IsBusy, "Missing image produces recoverable error");
            checks.Add("Mode state, clear and import error recovery");
            await Capture(window, Path.Combine(directory, "03-error.png"));
            vm.DismissErrorCommand.Execute(null);

            // A new selection supersedes a pending decode; old asynchronous work must not refill the card.
            var pending = vm.LoadFilesAsync([color], vm.Slots[0]);
            vm.Slots[0].RemoveCommand.Execute(null);
            await pending;
            Require(!vm.Slots[0].HasFile && !vm.IsBusy, "Removal prevents late import completion");
            checks.Add("Stale asynchronous imports cannot refill removed inputs");
            Require(bindingErrors.Errors.Count == 0, "WPF binding errors: " + string.Join(" | ", bindingErrors.Errors));
            checks.Add("All rendered modes have no WPF binding errors");
            File.WriteAllText(Path.Combine(directory, "result.json"), JsonSerializer.Serialize(new { passed = true, checks }, new JsonSerializerOptions { WriteIndented = true }));
        }
        finally
        {
            vm.Dispose();
            window.Close();
            PresentationTraceSources.DataBindingSource.Listeners.Remove(bindingErrors);
        }
    }

    private static async Task Capture(MainWindow window, string path)
    {
        await window.Dispatcher.InvokeAsync(() => { }, System.Windows.Threading.DispatcherPriority.ContextIdle);
        var root = (FrameworkElement)window.Content;
        root.Measure(new Size(1360, 840));
        root.Arrange(new Rect(0, 0, 1360, 840));
        root.UpdateLayout();
        await window.Dispatcher.InvokeAsync(() => { }, System.Windows.Threading.DispatcherPriority.ContextIdle);
        root.UpdateLayout();
        var render = new RenderTargetBitmap(1360, 840, 96, 96, PixelFormats.Pbgra32);
        render.Render(root);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(render));
        using var stream = File.Create(path);
        encoder.Save(stream);
    }

    private static string WriteFixture(string directory, string name, int kind)
    {
        const int side = 256;
        var rgba = new byte[side * side * 4];
        for (var y = 0; y < side; y++)
        for (var x = 0; x < side; x++)
        {
            var p = (y * side + x) * 4;
            var wave = (Math.Sin(x * .12) + Math.Cos(y * .16) + Math.Sin((x + y) * .07)) / 6 + .5;
            if (kind == 1)
                rgba[p] = rgba[p + 1] = rgba[p + 2] = (byte)(wave * 220 + 20);
            else if (kind == 2)
            {
                rgba[p] = 220;
                rgba[p + 1] = (byte)(Math.Sin(x * .09) * 48 + 128);
                rgba[p + 2] = (byte)(Math.Cos(y * .09) * 48 + 128);
            }
            else
            {
                rgba[p] = (byte)(wave * 150 + 65);
                rgba[p + 1] = (byte)(wave * 140 + 40);
                rgba[p + 2] = (byte)(wave * 120 + 35);
            }
            rgba[p + 3] = 255;
        }
        var bitmap = BitmapSource.Create(side, side, 96, 96, PixelFormats.Bgra32, null, rgba, side * 4);
        BitmapEncoder encoder = name.EndsWith(".tiff") ? new TiffBitmapEncoder() : new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        var path = Path.Combine(directory, name);
        using var file = File.Create(path);
        encoder.Save(file);
        return path;
    }

    private static void Require(bool condition, string description)
    {
        if (!condition) throw new InvalidOperationException(description);
    }

    private sealed class BindingTrace : TraceListener
    {
        public List<string> Errors { get; } = [];
        public override void Write(string? message) { if (!string.IsNullOrWhiteSpace(message)) Errors.Add(message); }
        public override void WriteLine(string? message) => Write(message);
    }
}
