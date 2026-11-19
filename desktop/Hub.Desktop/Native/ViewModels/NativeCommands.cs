using System.Windows.Input;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>Синхронная команда без параметра обработки исключений.</summary>
public sealed class NativeRelayCommand : ICommand
{
    private readonly Action<object?> _execute;
    private readonly Func<object?, bool>? _canExecute;

    public NativeRelayCommand(Action<object?> execute, Func<object?, bool>? canExecute = null)
    {
        _execute = execute ?? throw new ArgumentNullException(nameof(execute));
        _canExecute = canExecute;
    }

    public NativeRelayCommand(Action execute, Func<bool>? canExecute = null)
        : this(_ => execute(), canExecute is null ? null : _ => canExecute())
    {
    }

    public event EventHandler? CanExecuteChanged;

    public bool CanExecute(object? parameter) => _canExecute?.Invoke(parameter) ?? true;

    public void Execute(object? parameter) => _execute(parameter);

    public void RaiseCanExecuteChanged() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
}

/// <summary>
/// Асинхронная команда с защитой от повторного входа и маршаллингом ошибок в обработчик.
/// Ошибки не глотаются молча: делегат onError обязан отразить состояние в UI.
/// </summary>
public sealed class NativeAsyncCommand : ICommand
{
    private readonly Func<object?, CancellationToken, Task> _execute;
    private readonly Func<object?, bool>? _canExecute;
    private readonly Action<Exception> _onError;
    private bool _isRunning;

    public NativeAsyncCommand(
        Func<object?, CancellationToken, Task> execute,
        Action<Exception> onError,
        Func<object?, bool>? canExecute = null)
    {
        _execute = execute ?? throw new ArgumentNullException(nameof(execute));
        _onError = onError ?? throw new ArgumentNullException(nameof(onError));
        _canExecute = canExecute;
    }

    public event EventHandler? CanExecuteChanged;

    public bool IsRunning => _isRunning;

    public bool CanExecute(object? parameter) =>
        !_isRunning && (_canExecute?.Invoke(parameter) ?? true);

    public async void Execute(object? parameter)
    {
        await ExecuteAsync(parameter).ConfigureAwait(false);
    }

    public async Task ExecuteAsync(object? parameter, CancellationToken cancellationToken = default)
    {
        if (!CanExecute(parameter))
        {
            return;
        }

        _isRunning = true;
        RaiseCanExecuteChanged();
        try
        {
            await _execute(parameter, cancellationToken);
        }
        catch (Exception exception)
        {
            _onError(exception);
        }
        finally
        {
            _isRunning = false;
            RaiseCanExecuteChanged();
        }
    }

    public void RaiseCanExecuteChanged() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
}
