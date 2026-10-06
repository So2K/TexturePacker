using System.IO;
using System.Windows.Threading;
using ImageMagick;
using TexturePacker.Core;
using TexturePacker.Desktop.ViewModels;

internal static class Program
{
    private static int _assertions;
    private static void Check(bool ok, string reason)
    {
        if (!ok) throw new Exception(reason);
        _assertions++;
    }
    [STAThread]
    private static int Main()
    {
        SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext());
        try
        {
            var task = RunAsync();
            var frame = new DispatcherFrame();
            var timeout = new DispatcherTimer { Interval = TimeSpan.FromSeconds(60) };
            timeout.Tick += (_, _) => frame.Continue = false;
            timeout.Start();
            _ = task.ContinueWith(_ => frame.Continue = false, CancellationToken.None,
                TaskContinuationOptions.None, TaskScheduler.FromCurrentSynchronizationContext());
            Dispatcher.PushFrame(frame);
            timeout.Stop();
            if (!task.IsCompleted) throw new TimeoutException("Desktop interaction checks exceeded 60 seconds.");
            task.GetAwaiter().GetResult();
            Console.WriteLine($"PASS: {_assertions} desktop interaction assertions");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            return 1;
        }
    }

    private static async Task RunAsync()
    {
        var directory = Path.Combine(Path.GetTempPath(), "TexturePacker.Desktop.Tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try { await CheckInteractionsAsync(directory); }
        finally
        {
            // Delete only our explicit fixtures; never recursively remove a computed directory.
            foreach (var name in new[] { "red.png", "green.png", "red.tiff", "green.tiff" })
                File.Delete(Path.Combine(directory, name));
            Directory.Delete(directory);
        }
    }

    private static async Task CheckInteractionsAsync(string directory)
    {
        var red = Path.Combine(directory, "red.png");
        var green = Path.Combine(directory, "green.png");
        var redTiff = Path.Combine(directory, "red.tiff");
        var greenTiff = Path.Combine(directory, "green.tiff");
        using (var image = new MagickImage(MagickColors.Red, 16, 8)) image.Write(red);
        using (var image = new MagickImage(MagickColors.Green, 10, 12)) image.Write(green);
        using (var image = new MagickImage(MagickColors.Red, 16, 8)) { image.Depth = 16; image.Write(redTiff); }
        using (var image = new MagickImage(MagickColors.Green, 10, 12)) { image.Depth = 16; image.Write(greenTiff); }
        using var vm = new MainViewModel();
        Check(vm.CanProcess, "All fallback channel packing must be enabled");
        Check(vm.Slots.Select(s => s.FillWhite).SequenceEqual(new[] { true, true, false, true }), "Channel default fill values");
        await vm.LoadFilesAsync(new[] { red });
        var originalSlot = vm.Slots[0];
        Check(originalSlot.FilePath == red && originalSlot.HasFile && originalSlot.Preview != null, "Preview import succeeds");
        Check(originalSlot.Metadata.Contains("16 × 8"), "Original size metadata");
        using (var source = File.Open(red, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            Check(source.CanRead && source.CanWrite, "Imported files are not locked");
        vm.SelectedMode = vm.Modes.Single(m => m.Mode == TextureMode.CombineAlpha);
        Check(vm.CanProcess, "All fallback alpha combine must be enabled");
        await vm.LoadFilesAsync(new[] { green });
        vm.SelectedMode = vm.Modes[0];
        Check(ReferenceEquals(vm.Slots[0], originalSlot) && vm.Slots[0].FilePath == red, "Mode state preserves original sources");
        var first = vm.LoadFilesAsync(new[] { red }, originalSlot);
        var second = vm.LoadFilesAsync(new[] { green }, originalSlot);
        await Task.WhenAll(first, second);
        Check(originalSlot.FilePath == green && originalSlot.Metadata.Contains("10 × 12"), "Latest replacement wins async preview race");
        var clearing = vm.LoadFilesAsync(new[] { red }, originalSlot);
        originalSlot.RemoveCommand.Execute(null);
        await clearing;
        Check(!originalSlot.HasFile && originalSlot.Preview == null && !originalSlot.IsLoading, "Clear cancels preview and prevents stale result");
        await vm.LoadFilesAsync(new[] { green }, originalSlot);
        await vm.LoadFilesAsync(new[] { Path.Combine(directory, "missing.png") }, originalSlot);
        Check(originalSlot.FilePath == green && vm.HasError && originalSlot.HasError, "Failed import preserves valid source with visible error");
        vm.DismissErrorCommand.Execute(null);
        Check(!vm.HasError, "Error dismissal");
        var process = vm.ProcessCommand.ExecuteAsync();
        Check(vm.IsProcessing && !vm.CanEdit && vm.IsBusy, "Processing guards input editing");
        var chosenMode = vm.SelectedMode;
        vm.SelectedMode = vm.Modes[2];
        Check(ReferenceEquals(vm.SelectedMode, chosenMode), "Busy mode changes are ignored");
        await process;
        Check(vm.HasResult && vm.Preview != null && vm.ResultInfo.Contains("10 × 12"), "Pack command creates result");
        originalSlot.FillWhite = !originalSlot.FillWhite;
        Check(!vm.HasResult && vm.Preview == null, "Fallback changes invalidate processed result");
        vm.SelectedMode = vm.Modes.Single(m => m.Mode == TextureMode.Atlas);
        Check(!vm.CanProcess, "Empty atlas disabled");
        vm.AtlasColumns = 2;
        vm.AtlasRows = 2;
        await vm.LoadFilesAsync(new[] { red, green });
        var coordinateSlot = vm.Slots[1];
        Check(coordinateSlot.FilePath == green, "Multi-file atlas import fills empty slots");
        vm.AtlasColumns = 3;
        Check(ReferenceEquals(vm.Slots[1], coordinateSlot) && vm.Slots[1].Id == "atlas_1", "Atlas expansion preserves coordinates");
        vm.AtlasColumns = 1;
        vm.AtlasColumns = 3;
        Check(!ReferenceEquals(vm.Slots[1], coordinateSlot) && !vm.Slots[1].HasFile && vm.Slots[0].FilePath == red,
            "Atlas shrink discards outside tiles and expansion preserves only retained coordinates");
        vm.AtlasColumns = 100;
        vm.AtlasRows = -3;
        Check(vm.AtlasColumns == 20 && vm.AtlasRows == 1, "Atlas sides clamped 1..20");
        vm.AtlasColumns = 1;
        vm.ClearCommand.Execute(null);
        vm.AtlasColumns = 3;
        Check(vm.Slots.All(s => !s.HasFile), "Cleared atlas remains empty after grid expansion");
        vm.SelectedMode = vm.Modes.Single(m => m.Mode == TextureMode.InvertMap);
        Check(!vm.CanProcess, "Empty inversion disabled");
        vm.InvertPresetCommand.Execute("green");
        Check(!vm.InvertR && vm.InvertG && !vm.InvertB && !vm.InvertA, "Green-only normal preset");
        vm.InvertPresetCommand.Execute("all");
        Check(vm.InvertR && vm.InvertG && vm.InvertB && vm.InvertA, "RGBA inversion preset");
        vm.InvertPresetCommand.Execute("rgb");
        Check(vm.InvertR && vm.InvertG && vm.InvertB && !vm.InvertA, "RGB inversion preset");
        await vm.LoadFilesAsync(new[] { red });
        await vm.ProcessCommand.ExecuteAsync();
        Check(vm.HasResult, "Inversion result generated");
        vm.InvertG = false;
        Check(!vm.HasResult, "Inversion setting changes invalidate stale result");
        vm.SelectedMode = vm.Modes.Single(m => m.Mode == TextureMode.Convert16To8);
        Check(!vm.CanProcess, "Empty converter disabled");
        await vm.LoadFilesAsync(new[] { redTiff });
        await vm.LoadFilesAsync(new[] { greenTiff });
        Check(vm.Slots[0].FilePath == greenTiff, "Single-source global drop replaces current source");
        vm.ClearCommand.Execute(null);
        Check(!vm.Slots[0].HasFile && !vm.CanProcess, "Clear active slots");
        vm.SelectedMode = vm.Modes[0];
        var canceledProcess = vm.ProcessCommand.ExecuteAsync();
        vm.CancelCommand.Execute(null);
        await canceledProcess;
        Check(!vm.HasResult && !vm.IsBusy && vm.CanEdit, "Cancellation clears result and restores editing");
    }
}
