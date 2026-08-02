import { useState, useId } from 'react';
import type { PasswordStrength } from '@app/crypto';
import { evaluatePasswordStrength } from '@app/crypto';
import './PasswordStrengthInput.css';

interface PasswordStrengthInputProps {
  value: string;
  onChange: (value: string) => void;
  userInputs?: string[];
}

export function PasswordStrengthInput({
  value,
  onChange,
  userInputs = [],
}: PasswordStrengthInputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const inputId = useId();

  const analysis: PasswordStrength = evaluatePasswordStrength(value, userInputs);

  return (
    <div>
      <label htmlFor={inputId}>Password</label>

      <div>
        <input
          id={inputId}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter password..."
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? 'Hide' : 'Show'}
        </button>
      </div>

      {value && (
        <div className="strength-indicator">
          <div className="strength-meta">
            <span>
              Strength: <strong>{analysis.label}</strong>
            </span>
            <span>Est. offline crack time: {analysis.crackTimeDisplay}</span>
          </div>

          <div className="meter-track">
            {[0, 1, 2, 3].map((step) => {
              const isActive = analysis.score > step;
              const activeClass = isActive ? `active-score-${analysis.score}` : '';
              return <div key={step} className={`meter-segment ${activeClass}`} />;
            })}
          </div>

          {analysis.feedback.length > 0 && (
            <ul className="feedback-list">
              {analysis.feedback.map((item, index) => (
                <li key={index} className="feedback-item">
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
